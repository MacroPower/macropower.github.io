// Web Audio MIDI player for the volume dropdown and the Studio window.
// All audio state lives in module scope. The module does not persist it or
// touch any global, so the state lasts for the session only, like the state
// in prefs.ts. The first play or audition click creates the AudioContext, so
// the click satisfies the browser's autoplay policy and nothing autoplays.
//
// `configure(entries)` points the player at the site's MIDI playlist. On the
// first play, the player fetches the active track's file, parses it with
// midi.ts, and streams it. A setInterval lookahead schedules notes a
// fraction of a second ahead of the audio clock and loops at the song's end.
// The pitched voices build on "sine" oscillators and one custom periodic
// wave. They never use the built-in "square" or "triangle" types, which
// some Firefox builds play as silence. The GM drum channel (9) plays a
// synthesized kick, snare, and hat.
//
// The Studio window changes the music live through SynthParams, the
// channel strips, and a BPM override. The scheduler reads them when it
// schedules a note and looks about 0.2s ahead, so a knob turn lands within
// a beat. The mix runs master gain, lowpass, drive, and crush into a
// compressor, both dry and through the echo and reverb sends.

import { t } from "./i18n";
import { parseMidi, type MidiNote, type MidiSong } from "./midi";

// Quantize each note's onset and duration to this beat grid (a sixteenth
// note), so a loosely played MIDI file lands on a tidy grid. computeQuantize
// decides for each song. It leaves a file alone when its onsets do not sit on
// the sixteenth grid, such as triplets, fine sequencing, or tempo-warped
// sections, because snapping that material sounds badly quantized.
const QUANT = 0.25;
const quant = (beats: number): number => Math.round(beats / QUANT) * QUANT;

let quantizeActive = true; // recomputed whenever the active song changes

function computeQuantize(s: MidiSong): boolean {
  const sample = s.notes.slice(0, 4000);
  if (!sample.length) return true;
  let onGrid = 0;
  for (const note of sample) {
    const r = note.start / QUANT;
    if (Math.abs(r - Math.round(r)) * QUANT < 0.02) onGrid++;
  }
  return onGrid / sample.length >= 0.9;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

// ---- voices --------------------------------------------------------------

interface VoicePreset {
  readonly harmonics: readonly (readonly [mult: number, amp: number])[]; // partial multipliers + amplitudes
  readonly peak: number; // envelope peak, pre-master
}

// Additive recipes for the melody voice, which the Studio rack selects. A full
// multi-channel arrangement plays many notes at once, so each voice uses few
// oscillators and a modest peak and relies on the master compressor to level
// the mix. PARAM_DEFAULTS picks "square".
export type WaveKey = "sine" | "square" | "saw" | "organ";
const WAVES: Readonly<Record<WaveKey, VoicePreset["harmonics"]>> = {
  sine: [[1, 1]],
  square: [[1, 1], [3, 1 / 3]], // odd harmonics approximate a square's brightness
  saw: [[1, 1], [2, 1 / 2], [3, 1 / 3], [4, 1 / 4]],
  organ: [[0.5, 0.6], [1, 1], [2, 0.6], [4, 0.35]], // drawbar-ish, with a 16' sub
};

const MELODY_PEAK = 0.4;
const BASS: Readonly<VoicePreset> = { harmonics: [[1, 1]], peak: 0.42 };
const KICK_PEAK = 0.32;
const SNARE_PEAK = 0.18;
const HAT_PEAK = 0.1;
// Notes below this MIDI number (C3) use the bass voice, and the rest use the
// melody voice. The split is crude but works for a typical pop arrangement.
export const BASS_MAX_PITCH = 48;

// ---- tweakable state ------------------------------------------------------

// The Studio's synth rack. The scheduler reads it as it schedules each note,
// so an edit lands within the lookahead window. PARAM_DEFAULTS turns every
// effect off and sets velSens to 0.5, so the file's velocities change the
// loudness from the first play.
export interface SynthParams {
  wave: VoiceKey; // melody voice of "auto" strips, which takes any VoiceKey
  attack: number; // seconds (both pitched voices)
  release: number; // 0..1, scales the note-length decay target
  oct: number; // pitched-voice octave shift, -2..+2 (integer)
  detune: number; // unison detune in cents. A positive value doubles each partial into a ± pair
  vib: number; // vibrato depth in cents (one shared 5.5Hz LFO)
  cutoff: number; // Hz, master lowpass (12kHz ≈ neutral)
  drive: number; // 0..1 waveshaper saturation
  crush: number; // 0..1 bit-depth reduction (0 = bypass, 1 ≈ 3 bits)
  echo: number; // 0..1, send into the tempo-synced delay
  echoDiv: number; // delay length in beats: 0.5 (1/8), 0.75 (dotted 1/8), 1 (1/4)
  verb: number; // 0..1, send into the convolver reverb
  width: number; // 0..1 pitch-keyed stereo spread
  swing: number; // 0..1, off-eighth delay (1 = a full sixteenth late)
  humanize: number; // 0..1 random timing jitter + level wobble
  velSens: number; // 0..1 velocity-to-loudness sensitivity
}

export const PARAM_DEFAULTS: Readonly<SynthParams> = {
  wave: "square",
  attack: 0.008,
  release: 1,
  oct: 0,
  detune: 0,
  vib: 0,
  cutoff: 12000,
  drive: 0,
  crush: 0,
  echo: 0,
  echoDiv: 0.75,
  verb: 0,
  width: 0,
  swing: 0,
  humanize: 0,
  velSens: 0.5,
};

// setParam replaces this object and never writes into it, so params
// starts as the defaults object itself. Copying the defaults here takes
// an object spread, and esbuild keeps a top-level spread in the app
// bundle of a site without the Studio.
let params: Readonly<SynthParams> = PARAM_DEFAULTS;

// The current params, typed read-only so that every write goes through
// setParam, which also updates the audio graph. setParam replaces the
// object, so a result read earlier keeps the values it had.
export function getParams(): Readonly<SynthParams> {
  return params;
}

export function setParam<K extends keyof SynthParams>(key: K, value: SynthParams[K]): void {
  const next = { ...params };
  next[key] = value;
  params = next;
  if (graph) {
    const now = graph.ctx.currentTime;
    if (key === "cutoff") graph.filter.frequency.setTargetAtTime(params.cutoff, now, 0.03);
    if (key === "echo") graph.echoSend.gain.setTargetAtTime(params.echo * 0.55, now, 0.03);
    if (key === "verb") graph.verbSend.gain.setTargetAtTime(params.verb * 0.5, now, 0.03);
    if (key === "vib") graph.vibDepth.gain.setTargetAtTime(params.vib, now, 0.03);
    if (key === "drive") graph.driveShaper.curve = driveCurve(params.drive);
    if (key === "crush") graph.crushShaper.curve = crushCurve(params.crush);
    if (key === "echoDiv") syncDelayTime(graph);
  }
  emit();
}

// tanh soft clip, normalized so full scale stays full scale. Null = bypass.
function driveCurve(amount: number): Float32Array<ArrayBuffer> | null {
  if (amount <= 0) return null;
  const k = 1 + amount * 24;
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

// Amplitude staircase: 12 bits (subtle grit) down to 3 (chiptune rubble).
function crushCurve(amount: number): Float32Array<ArrayBuffer> | null {
  if (amount <= 0) return null;
  const bits = Math.round(12 - amount * 9);
  const levels = 2 ** (bits - 1);
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

// Per-strip instrument patches. "auto" splits the strip at C3, with the bass
// voice below it and the Synth section's voice from C3 up. Every other patch
// pins the whole strip to one synth: an additive table, a band-limited pulse,
// one of two 2-op FM voices, a pluck, or a pad. The scheduler reads the patch
// as it schedules each note, like every other param.
export type PatchKey =
  | "auto" | "sine" | "square" | "saw" | "organ"
  | "pulse" | "epiano" | "bell" | "pluck" | "pad";

// Any concrete voice. A strip pins itself to one, and the global selector in
// the Synth section picks one for the melody register of "auto" strips.
export type VoiceKey = Exclude<PatchKey, "auto">;

// Per-strip mixer state. The Studio changes the returned object directly, and
// the scheduler reads it as it schedules each note.
export interface ChannelStrip {
  gain: number; // 0..1.5
  muted: boolean;
  solo: boolean;
  patch: PatchKey;
}

const strips = new Map<number, ChannelStrip>();

// When all of a song's pitched notes sit on one MIDI channel, as in a solo
// piano arrangement, the engine's split into bass and melody voices is the
// song's only "multitrack" structure. The mixer then shows the two voices as
// two strips, so it matches what you hear. loadSong sets the flag again
// whenever the active song changes.
let splitVoices = false;

function computeSplitVoices(s: MidiSong): boolean {
  const pitched = new Set<number>();
  for (const n of s.notes) if (n.channel !== 9) pitched.add(n.channel);
  return pitched.size === 1;
}

// Mixer-strip key for a note, normally its MIDI channel. Under the voice
// split, the bass register of the lone channel gets a strip of its own.
function stripKey(channel: number, pitch: number): number {
  if (channel !== 9 && splitVoices && pitch < BASS_MAX_PITCH) return 256 | channel;
  return channel;
}

// Each note's strip, which the first lookup freezes. The Studio groups its
// track strips from the same memo. Live transposition changes a note's pitch
// in place. Without the freeze, dragging a split-voice note across the bass
// boundary sends it to a different strip than the one that shows and dims it.
const noteStrips = new WeakMap<MidiNote, number>();

export function noteStripKey(n: MidiNote): number {
  let k = noteStrips.get(n);
  if (k === undefined) {
    k = stripKey(n.channel, n.pitch);
    noteStrips.set(n, k);
  }
  return k;
}

export function strip(key: number): ChannelStrip {
  let s = strips.get(key);
  if (!s) {
    s = { gain: 1, muted: false, solo: false, patch: "auto" };
    strips.set(key, s);
  }
  return s;
}

// Effective strip gain after mute and solo. Any solo silences every strip
// without solo, and mute always wins.
function stripGain(key: number, anySolo: boolean): number {
  const s = strips.get(key);
  if (!s) return anySolo ? 0 : 1;
  if (s.muted) return 0;
  if (anySolo && !s.solo) return 0;
  return s.gain;
}

// Play, stop, and param changes notify subscribers, so the top panel's play
// glyph and the Studio transport stay in step.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(): void {
  for (const fn of listeners) fn();
}

// ---- module state ----------------------------------------------------------

// The context and the mix-chain nodes that the live params drive.
// ensureChain() builds every node at once, so the module holds either the
// whole graph or none of it.
interface AudioGraph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly filter: BiquadFilterNode;
  readonly echoSend: GainNode;
  readonly delayNode: DelayNode;
  readonly verbSend: GainNode;
  readonly driveShaper: WaveShaperNode;
  readonly crushShaper: WaveShaperNode;
  readonly vibDepth: GainNode; // LFO → this → every oscillator's detune
}

let graph: AudioGraph | null = null;
let playing = false;
let starting = false; // guards the async gap in toggle(), so two fast clicks cannot start twice
let level = 62; // 0..100, mirrors the slider's initial value
let muted = false;
let noiseBuf: AudioBuffer | null = null;

// Every scheduled source, oscillators and noise buffer sources alike, so stop
// can halt them all. Each source leaves the set on its own "ended" event.
const voices = new Set<AudioScheduledSourceNode>();

// MIDI source + streaming-playback state. The playlist comes from the
// theme's unity/playlist.html. A track without a title shows as "Track N",
// where N counts its place in the playlist. Its song stays a surprise
// until you press play. The cache below keeps each parsed song by URL, so flipping
// back to a track is instant and keeps its note edits. Both last only for
// the session.

/** One Studio track: its MIDI file's URL and its title, empty for an
 *  anonymous track. */
export interface PlaylistEntry {
  url: string;
  title: string;
}

let playlist: PlaylistEntry[] = [];
let trackIdx = 0;
const songCache = new Map<string, Promise<MidiSong | null>>();
let song: MidiSong | null = null;
let lookahead: ReturnType<typeof setInterval> | null = null;
let loopBase = 0; // ctx time at which the current iteration's beat 0 sounds
let loopDurSec = 0; // length of one full pass through the song, in seconds
let noteIdx = 0; // index into song.notes already scheduled this iteration
let secPerBeat = 0.5;
let bpmOverride: number | null = null; // Studio override; null = the file's tempo
let pausedAt = 0; // in beats: where a pause left off, or where a seek points while stopped

// Point the player at the bundled MIDI playlist. loadSong fetches each entry
// the first time the player or the Studio asks for it.
export function configure(entries: readonly PlaylistEntry[]): void {
  playlist = entries.filter((e) => e.url);
  trackIdx = 0;
}

function loadSong(): Promise<MidiSong | null> {
  const url = playlist[trackIdx]?.url;
  if (!url) return Promise.resolve(null);
  let p = songCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => parseMidi(buf))
      .catch(() => null);
    songCache.set(url, p);
    // Do not cache a failure. Evicting it lets the next play or track switch
    // retry the fetch, instead of leaving the track dead for the session.
    void p.then((s) => {
      if (s === null) songCache.delete(url);
    });
  }
  return p.then((s) => {
    // A stale resolve (the user switched tracks mid-fetch) must not clobber
    // the engine's active song.
    if (url === playlist[trackIdx]?.url) {
      song = s;
      quantizeActive = s ? computeQuantize(s) : true;
      splitVoices = s ? computeSplitVoices(s) : false;
    }
    return s;
  });
}

// The active track's parsed song, which the first call fetches. The returned
// object is the live playback source. The Studio's piano roll renders it, and
// note edits such as transposition change it in place, so the scheduler plays
// them on its next pass. Resolves null when the MIDI fails to load.
export function getSong(): Promise<MidiSong | null> {
  return loadSong();
}

export function trackIndex(): number {
  return trackIdx;
}

export function trackCount(): number {
  return playlist.length;
}

// Switch the active playlist entry, wrapping around at each end. A playing
// player keeps playing and starts the new song from the top. The mixer strips
// and the tempo override belong to one song, so they reset. The synth and FX
// params stay, because they are the user's sound design.
export async function selectTrack(i: number): Promise<void> {
  if (!playlist.length) return;
  const next = ((i % playlist.length) + playlist.length) % playlist.length;
  if (next === trackIdx) return;
  const wasPlaying = playing;
  if (playing) stopPlayback();
  trackIdx = next;
  song = null;
  pausedAt = 0;
  bpmOverride = null;
  strips.clear();
  emit();
  if (wasPlaying) await toggle();
}

// Perceptual, but comfortably less than full scale, so the loop never
// startles. Squaring the normalized level tracks loudness better than a linear
// map, and the master compressor catches any stray peaks. Muted is silent.
function masterGain(): number {
  if (muted) return 0;
  const norm = level / 100;
  return norm * norm * 0.5;
}

function applyGain(): void {
  if (graph) graph.master.gain.setTargetAtTime(masterGain(), graph.ctx.currentTime, 0.02);
}

function noiseBuffer(audio: AudioContext): AudioBuffer {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(audio.sampleRate * 0.2);
  noiseBuf = audio.createBuffer(1, len, audio.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function trackSource(src: AudioScheduledSourceNode): void {
  voices.add(src);
  src.addEventListener("ended", () => voices.delete(src));
}

function addOsc(audio: AudioContext, hz: number, gainVal: number, dest: AudioNode, t: number, dur: number, cents = 0): void {
  if (hz >= audio.sampleRate / 2) return; // skip above Nyquist
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.value = hz;
  if (cents !== 0) osc.detune.value = cents;
  // The shared vibrato LFO sums into each oscillator's detune. Its depth
  // gain is live, so the VIB knob also changes notes that are already ringing.
  graph?.vibDepth.connect(osc.detune);
  const g = audio.createGain();
  g.gain.value = gainVal;
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur);
  trackSource(osc);
}

// A pitched note. One shared envelope gain feeds the master, and each harmonic
// oscillator feeds that gain. Normalizing by the amplitude sum bounds the
// in-phase peak before the envelope and master gain. `gf` is the channel
// strip's gain, and the attack and release come from the live params.
function scheduleTone(audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, p: VoicePreset, gf: number): void {
  const attack = clamp(params.attack, 0.001, 0.2);
  const decayEnd = t + Math.max(attack + 0.03, dur * 0.9 * clamp(params.release, 0.1, 1));
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(p.peak * gf, t + attack);
  env.gain.linearRampToValueAtTime(0.001, decayEnd);
  env.connect(out);
  const norm = p.harmonics.reduce((s, [, a]) => s + a, 0);
  const det = clamp(params.detune, 0, 50);
  for (const [mult, amp] of p.harmonics) {
    const g = (amp / norm) * (det > 0 ? 0.5 : 1);
    addOsc(audio, freq * mult, g, env, t, dur, det > 0 ? -det : 0);
    // Unison: a second oscillator per partial, detuned the other way. The
    // beating between the pair thickens the sound like a classic analog chorus.
    if (det > 0) addOsc(audio, freq * mult, g, env, t, dur, det);
  }
}

function scheduleKick(audio: AudioContext, out: AudioNode, t: number, gf: number): void {
  if (gf <= 0) return;
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(KICK_PEAK * gf, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + 0.2);
  trackSource(osc);
}

function scheduleNoise(audio: AudioContext, out: AudioNode, t: number, hp: number, peak: number, decay: number): void {
  if (peak <= 0) return;
  const src = audio.createBufferSource();
  src.buffer = noiseBuffer(audio);
  const filt = audio.createBiquadFilter();
  filt.type = "highpass";
  filt.frequency.value = hp;
  const g = audio.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filt);
  filt.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(t + decay + 0.01);
  trackSource(src);
}

function freqOf(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

// ---- patch engines ---------------------------------------------------------

// Band-limited 25%-duty pulse via Fourier coefficients (browsers render
// PeriodicWave alias-free, unlike a raw harmonic stack near Nyquist). Built
// once per context.
let pulsePW: PeriodicWave | null = null;

function pulseWave(audio: AudioContext): PeriodicWave {
  if (pulsePW) return pulsePW;
  const N = 24;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let n = 1; n <= N; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
  }
  pulsePW = audio.createPeriodicWave(real, imag);
  return pulsePW;
}

// The chip lead: one pulse oscillator, or a ± unison pair under DET, through
// the standard envelope.
function schedulePulse(audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gf: number): void {
  if (freq >= audio.sampleRate / 2) return;
  const attack = clamp(params.attack, 0.001, 0.2);
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.3 * gf, t + attack);
  env.gain.linearRampToValueAtTime(0.001, t + Math.max(attack + 0.03, dur * 0.9 * clamp(params.release, 0.1, 1)));
  env.connect(out);
  const det = clamp(params.detune, 0, 50);
  const make = (cents: number, g: number): void => {
    const osc = audio.createOscillator();
    osc.setPeriodicWave(pulseWave(audio));
    osc.frequency.value = freq;
    if (cents !== 0) osc.detune.value = cents;
    graph?.vibDepth.connect(osc.detune);
    const og = audio.createGain();
    og.gain.value = g;
    osc.connect(og);
    og.connect(env);
    osc.start(t);
    osc.stop(t + dur);
    trackSource(osc);
  };
  if (det > 0) { make(-det, 0.5); make(det, 0.5); }
  else make(0, 1);
}

// 2-op FM: modulator → index gain (deviation in Hz, decaying) → carrier
// frequency. The ratio, index, and decay set the e-piano apart from the bell,
// and the bell rings past the written note length.
function scheduleFM(
  audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gf: number,
  ratio: number, index: number, idxDecay: number, ring: number, peak: number,
): void {
  if (freq >= audio.sampleRate / 2) return;
  const len = Math.min(Math.max(dur, ring), 3);
  const attack = clamp(params.attack, 0.001, 0.2);
  const rel = clamp(params.release, 0.1, 1);
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak * gf, t + attack);
  env.gain.exponentialRampToValueAtTime(0.001, t + Math.max(attack + 0.05, len * rel));
  env.connect(out);
  const car = audio.createOscillator();
  car.type = "sine";
  car.frequency.value = freq;
  graph?.vibDepth.connect(car.detune);
  const mod = audio.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq * ratio;
  const mg = audio.createGain();
  mg.gain.setValueAtTime(index * freq * ratio, t);
  mg.gain.exponentialRampToValueAtTime(1, t + idxDecay); // brightness fades first
  mod.connect(mg);
  mg.connect(car.frequency);
  car.connect(env);
  car.start(t);
  mod.start(t);
  car.stop(t + len);
  mod.stop(t + len);
  trackSource(car);
  trackSource(mod);
}

// Instant-attack bright stack with an exponential decay and a filtered noise
// tick on the front. It sounds plucked whatever the written duration.
function schedulePluck(audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gf: number): void {
  const decay = Math.max(0.08, Math.min(dur, 0.5) * clamp(params.release, 0.1, 1));
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.42 * gf, t + Math.min(params.attack, 0.005));
  env.gain.exponentialRampToValueAtTime(0.001, t + decay);
  env.connect(out);
  const table: [number, number][] = [[1, 1], [2, 0.45], [3, 0.22], [5, 0.08]];
  const norm = table.reduce((s, [, a]) => s + a, 0);
  const det = clamp(params.detune, 0, 50);
  for (const [mult, amp] of table) {
    const g = (amp / norm) * (det > 0 ? 0.5 : 1);
    addOsc(audio, freq * mult, g, env, t, decay + 0.05, det > 0 ? -det : 0);
    if (det > 0) addOsc(audio, freq * mult, g, env, t, decay + 0.05, det);
  }
  scheduleNoise(audio, out, t, 3000, 0.05 * gf, 0.03);
}

// Slow-attack detuned wash, close to a saw. The global DET adds to its own
// detune. The oscillators always outlive the attack ramp, because a staccato
// note would otherwise stop hard mid-swell with an audible click.
function schedulePad(audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, gf: number): void {
  const attack = Math.max(params.attack, 0.18);
  const decayEnd = Math.max(attack + 0.1, dur * clamp(params.release, 0.1, 1));
  const len = Math.max(dur, decayEnd + 0.05);
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.3 * gf, t + attack);
  env.gain.linearRampToValueAtTime(0.001, t + decayEnd);
  env.connect(out);
  const table: [number, number][] = [[1, 1], [2, 0.5], [3, 0.33], [4, 0.25]];
  const norm = table.reduce((s, [, a]) => s + a, 0);
  const det = 6 + clamp(params.detune, 0, 50);
  for (const [mult, amp] of table) {
    const g = (amp / norm) * 0.5;
    addOsc(audio, freq * mult, g, env, t, len, -det);
    addOsc(audio, freq * mult, g, env, t, len, det);
  }
}

// Pitch-keyed stereo placement: low notes lean left, high lean right, scaled
// by the WIDTH knob. Identity (no extra node) when width is off.
function panned(audio: AudioContext, out: AudioNode, panPitch: number): AudioNode {
  if (params.width <= 0 || typeof audio.createStereoPanner !== "function") return out;
  const p = audio.createStereoPanner();
  p.pan.value = clamp(((panPitch - 60) / 36) * params.width, -0.85, 0.85);
  p.connect(out);
  return p;
}

// Schedule one concrete voice. Shared by every pitched path: a strip's
// pinned patch, the "auto" melody register (driven by the global selector),
// and auditions.
function renderVoice(audio: AudioContext, dest: AudioNode, t: number, freq: number, dur: number, gf: number, voice: VoiceKey): void {
  switch (voice) {
    case "sine":
    case "square":
    case "saw":
    case "organ":
      scheduleTone(audio, dest, t, freq, dur, { harmonics: WAVES[voice], peak: MELODY_PEAK }, gf);
      break;
    case "pulse":
      schedulePulse(audio, dest, t, freq, dur, gf);
      break;
    case "epiano":
      scheduleFM(audio, dest, t, freq, dur, gf, 2, 1.2, 0.5, 0.7, 0.45);
      break;
    case "bell":
      scheduleFM(audio, dest, t, freq, dur, gf, 3.51, 1.8, 1.1, 1.6, 0.4);
      break;
    case "pluck":
      schedulePluck(audio, dest, t, freq, dur, gf);
      break;
    case "pad":
      schedulePad(audio, dest, t, freq, dur, gf);
      break;
  }
}

// Render one MIDI note at absolute context time `t`. Channel 9 is the GM drum
// kit, and renderNote maps its note numbers to the kick, snare, and hat. Every
// other channel plays its strip's instrument patch. The "auto" patch keeps the
// classic split, with the bass preset below C3 and the selected voice from C3
// up.
function renderNote(audio: AudioContext, out: AudioNode, n: MidiNote, t: number, dur: number, gf: number): void {
  if (n.channel === 9) {
    // Drum pan positions are fixed kit placements, not GM note numbers.
    if (n.pitch === 35 || n.pitch === 36) scheduleKick(audio, panned(audio, out, 60), t, gf);
    else if (n.pitch === 38 || n.pitch === 40) scheduleNoise(audio, panned(audio, out, 54), t, 1800, SNARE_PEAK * gf, 0.12);
    else scheduleNoise(audio, panned(audio, out, 68), t, 7000, HAT_PEAK * gf, 0.05);
    return;
  }
  const freq = freqOf(n.pitch) * 2 ** clamp(Math.round(params.oct), -2, 2);
  const dest = panned(audio, out, n.pitch);
  const patch = strip(noteStripKey(n)).patch;
  if (patch === "auto") {
    if (n.pitch < BASS_MAX_PITCH) scheduleTone(audio, dest, t, freq, dur, BASS, gf);
    else renderVoice(audio, dest, t, freq, dur, gf, params.wave);
    return;
  }
  renderVoice(audio, dest, t, freq, dur, gf, patch);
}

// Onset (quantized when the song lives on the grid) with swing applied: every
// off-eighth (the ". and" of the grid) lands late by up to a sixteenth. The
// off-eighth test is a tolerance window, not exact equality, so swing still
// works on unquantized songs. Skew is well inside the lookahead margin, so
// the in-order scheduler stays correct.
function swungStart(startBeats: number): number {
  const q = quantizeActive ? quant(startBeats) : startBeats;
  if (params.swing > 0) {
    const frac = ((q % 1) + 1) % 1;
    if (Math.abs(frac - 0.5) <= 0.08) return q + params.swing * QUANT;
  }
  return q;
}

// Lookahead: schedule every note whose onset, quantized when the song sits on
// the grid, falls within the next 0.2s or so. Then loop when the iteration has
// no notes left and the clock has passed the song's end.
function pump(audio: AudioContext, out: AudioNode): void {
  if (!song) return;
  const horizon = audio.currentTime + 0.2;
  const notes = song.notes;
  let anySolo = false;
  for (const s of strips.values()) if (s.solo) { anySolo = true; break; }
  for (let n = notes[noteIdx]; n !== undefined; n = notes[noteIdx]) {
    const base = loopBase + swungStart(n.start) * secPerBeat;
    if (base > horizon) break;
    if (n.dead) { noteIdx++; continue; } // muted from the piano roll
    let gf = stripGain(noteStripKey(n), anySolo);
    if (gf > 0) {
      // Velocity sensitivity blends flat loudness toward the file's dynamics,
      // and humanize adds per-note timing slop and level wobble on top.
      gf *= (1 - params.velSens) + params.velSens * n.vel;
      let t = base;
      if (params.humanize > 0) {
        t += (Math.random() * 2 - 1) * params.humanize * 0.025;
        gf *= 1 - Math.random() * params.humanize * 0.3;
      }
      const durBeats = quantizeActive ? quant(n.dur) : n.dur;
      renderNote(audio, out, n, t, Math.max(0.05, durBeats * secPerBeat), gf);
    }
    noteIdx++;
  }
  if (noteIdx >= notes.length && audio.currentTime >= loopBase + loopDurSec) {
    loopBase += loopDurSec;
    noteIdx = 0;
  }
}

// First note index at or past `beat`. The notes run in start order, so a
// resume or a seek skips every note before the entry point.
function noteIndexAt(beat: number): number {
  if (!song) return 0;
  const i = song.notes.findIndex((n) => n.start >= beat);
  return i === -1 ? song.notes.length : i;
}

function startPlayer(g: AudioGraph): void {
  secPerBeat = 60 / bpm();
  loopDurSec = song!.durationBeats * secPerBeat;
  // Resume from wherever a pause or a seek left the transport, or from 0
  // after a hard stop.
  const startBeat = clamp(pausedAt, 0, song!.durationBeats);
  loopBase = g.ctx.currentTime + 0.1 - startBeat * secPerBeat;
  noteIdx = noteIndexAt(startBeat);
  syncDelayTime(g);
  pump(g.ctx, g.master);
  lookahead = setInterval(() => pump(g.ctx, g.master), 40);
}

function stopVoices(): void {
  if (lookahead !== null) {
    clearInterval(lookahead);
    lookahead = null;
  }
  for (const v of voices) {
    try {
      v.stop();
    } catch {
      // The source has already stopped or ended.
    }
  }
  voices.clear();
}

function stopPlayback(): void {
  stopVoices();
  playing = false;
  emit();
}

// Decaying stereo noise burst, a serviceable small-room impulse for the
// convolver. The module generates it instead of shipping a file.
function impulseBuffer(audio: AudioContext): AudioBuffer {
  const len = Math.floor(audio.sampleRate * 1.6);
  const buf = audio.createBuffer(2, len, audio.sampleRate);
  for (let chn = 0; chn < 2; chn++) {
    const data = buf.getChannelData(chn);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
  }
  return buf;
}

// Build the context and the mix chain on the first user gesture. Master gain
// feeds the lowpass, drive, and crush, which feed the compressor dry and
// through two sends at the end of the chain: a tempo-synced feedback delay
// and a convolver reverb. The echoes and tails therefore keep the cutoff and
// the dirt. A null WaveShaper curve passes the signal through, so the off
// positions cost nothing. Returns null when the browser has no Web Audio,
// such as Firefox with media.webaudio.enabled off.
function ensureChain(): AudioGraph | null {
  if (graph) return graph;
  if (typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = 0.9;
  const driveShaper = ctx.createWaveShaper();
  driveShaper.oversample = "2x";
  driveShaper.curve = driveCurve(params.drive);
  const crushShaper = ctx.createWaveShaper();
  crushShaper.oversample = "2x";
  crushShaper.curve = crushCurve(params.crush);
  const comp = ctx.createDynamicsCompressor(); // safety limiter on the mix
  master.connect(filter);
  filter.connect(driveShaper);
  driveShaper.connect(crushShaper);
  const post = crushShaper;
  post.connect(comp);
  const echoSend = ctx.createGain();
  echoSend.gain.value = params.echo * 0.55;
  const delayNode = ctx.createDelay(2);
  delayNode.delayTime.value = params.echoDiv * secPerBeat;
  const fb = ctx.createGain();
  fb.gain.value = 0.42;
  post.connect(echoSend);
  echoSend.connect(delayNode);
  delayNode.connect(fb);
  fb.connect(delayNode);
  delayNode.connect(comp);
  const verbSend = ctx.createGain();
  verbSend.gain.value = params.verb * 0.5;
  const conv = ctx.createConvolver();
  conv.buffer = impulseBuffer(ctx);
  post.connect(verbSend);
  verbSend.connect(conv);
  conv.connect(comp);
  // One always-running vibrato LFO; addOsc taps it into each oscillator.
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 5.5;
  const vibDepth = ctx.createGain();
  vibDepth.gain.value = params.vib;
  lfo.connect(vibDepth);
  lfo.start();
  comp.connect(ctx.destination);
  graph = { ctx, master, filter, echoSend, delayNode, verbSend, driveShaper, crushShaper, vibDepth };
  return graph;
}

// Tempo-synced echo tap of 1/8, dotted 1/8, or 1/4, which the TIME selector
// picks. startPlayer, setBpm, and setParam call it, so the tap follows each
// tempo and division change.
function syncDelayTime(g: AudioGraph): void {
  g.delayNode.delayTime.setTargetAtTime(params.echoDiv * secPerBeat, g.ctx.currentTime, 0.05);
}

// Start or pause playback. The promise resolves to the new playing state. The
// first call creates the context during the user gesture, and each call
// resumes it in case it starts suspended. When it stays suspended, as in some
// mobile and embedded browsers, or the MIDI fails to load, toggle reports not
// playing, so the UI never claims a sound that is not there.
export async function toggle(): Promise<boolean> {
  if (playing) {
    pausedAt = positionBeats(); // pause, not stop, so the next start resumes here
    stopPlayback();
    return false;
  }
  if (starting) return false; // an earlier click is still starting, so ignore this one
  starting = true;
  try {
    const g = ensureChain();
    if (!g) return false;
    g.master.gain.value = masterGain();
    await g.ctx.resume();
    if (g.ctx.state !== "running") return false;
    const loaded = await loadSong();
    if (!loaded) return false; // MIDI failed to load
    // selectTrack() might have switched the playlist entry while the fetch was
    // in flight. `song` then stays null, because the stale guard in loadSong
    // skips the assignment. Starting the player on the orphaned result reads a
    // null song, so stay paused. The switch has already emitted the
    // consistent state.
    if (loaded !== song) return false;
    playing = true;
    startPlayer(g);
    emit();
    return true;
  } finally {
    starting = false;
  }
}

// Hard stop for the Studio transport. Unlike the pause in toggle(), it rewinds
// to the top. It emits even when already paused, so the playhead UI rewinds
// too.
export function stop(): void {
  pausedAt = 0;
  if (playing) stopPlayback();
  else emit();
}

export function isPlaying(): boolean {
  return playing;
}

// The active track's title, or "Track N" for an anonymous one.
export function trackName(): string {
  const entry = playlist[trackIdx];
  if (!entry) return "";
  return entry.title || t("js_sound_track", { n: trackIdx + 1 });
}

// The active tempo: the Studio override if set, else the file's tempo.
export function bpm(): number {
  return bpmOverride ?? song?.bpm ?? 120;
}

export function songBpm(): number {
  return song?.bpm ?? 120;
}

// Override the tempo and re-anchor the loop, so the playhead does not jump.
// The current beat stays the current beat, and only the beat length changes.
// Notes already scheduled, up to 0.2s ahead, keep the old timing.
export function setBpm(value: number): void {
  bpmOverride = clamp(Math.round(value), 40, 240);
  if (graph && playing && song) {
    const now = graph.ctx.currentTime;
    const beat = (now - loopBase) / secPerBeat;
    secPerBeat = 60 / bpmOverride;
    loopBase = now - beat * secPerBeat;
    loopDurSec = song.durationBeats * secPerBeat;
    syncDelayTime(graph);
  }
  emit();
}

// Playhead position in beats into the current loop. While nothing plays, the
// position is the resume point: the pause position, the seek target, or 0
// after a hard stop.
export function positionBeats(): number {
  if (!graph || !playing || !song) return pausedAt;
  return clamp((graph.ctx.currentTime - loopBase) / secPerBeat, 0, song.durationBeats);
}

// Jump the transport to an absolute beat. During playback, seek cuts every
// voice, including the scheduled lookahead, because those voices would echo
// the old position. It then re-anchors the loop, and the pump refills from
// the new spot on its next tick. While paused, seek moves only the resume
// point.
export function seek(beats: number): void {
  if (!song) return;
  const b = clamp(beats, 0, song.durationBeats);
  pausedAt = b;
  if (graph && playing) {
    for (const v of voices) {
      try {
        v.stop();
      } catch {
        // The source has already stopped or ended.
      }
    }
    voices.clear();
    loopBase = graph.ctx.currentTime + 0.06 - b * secPerBeat;
    noteIdx = noteIndexAt(b);
  }
  emit();
}

// One-shot note preview through the live chain, for piano-roll clicks and
// transpose drags. It creates or resumes the context, because every caller
// runs in a user gesture.
export function auditionNote(pitch: number, channel = 0): void {
  const g = ensureChain();
  if (!g) return;
  g.master.gain.value = masterGain();
  void g.ctx.resume().then(() => {
    if (g.ctx.state !== "running") return;
    const t = g.ctx.currentTime + 0.02;
    const n: MidiNote = { channel, pitch, start: 0, dur: 0, vel: 0.9 };
    // Play at full gain whatever the mixer holds, so a preview is always audible.
    renderNote(g.ctx, g.master, n, t, 0.35, 1);
  });
}

export function setVolume(level0to100: number): void {
  level = level0to100;
  applyGain();
}

export function setMuted(on: boolean): void {
  muted = on;
  applyGain();
}
