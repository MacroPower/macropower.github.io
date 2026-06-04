// Web Audio MIDI player for the volume dropdown and the Studio window.
// Self-contained: all audio state lives in module scope, nothing is persisted,
// and no globals are touched — same session-only style as prefs.ts. The
// AudioContext is created lazily on the first play/audition click, so the user
// gesture satisfies the browser's autoplay policy and nothing autoplays.
//
// `configure(url, name)` points it at a bundled .mid; on first play the file is
// fetched and parsed (midi.ts), then streamed: a setInterval lookahead schedules
// notes a fraction of a second ahead of the audio clock and loops at the end.
// Every pitched note is voiced additively from plain "sine" oscillators (built-in
// "square"/"triangle" types are silent in some Firefox builds); the GM drum
// channel (9) is rendered with a synthesized kick/snare/hat.
//
// Everything musical is live-tweakable (the Studio window drives it): a synth
// param block (waveform, attack, release, filter cutoff, echo send, swing),
// per-channel mute/solo/gain, and a BPM override. Params are read at schedule
// time and the lookahead is short (~0.2s), so a knob turn lands within a beat.
// The mix runs master gain → lowpass filter → (dry + tempo-synced echo) →
// compressor, the compressor taming peaks as before.

import { parseMidi, type MidiNote, type MidiSong } from "./midi";

// Quantize note onsets/durations to this beat grid (a sixteenth note) so a
// loosely-played MIDI lands on a tidy grid. Adaptive per song: a file whose
// onsets don't live on the sixteenth grid (triplet writing, fine sequencing,
// tempo-warped sections) is left untouched — snapping that material is what
// "badly quantized" sounds like. See computeQuantize.
const QUANT = 0.25;
const quant = (beats: number): number => Math.round(beats / QUANT) * QUANT;

let quantizeActive = true; // recomputed whenever the active song changes

function computeQuantize(s: MidiSong): boolean {
  const n = Math.min(s.notes.length, 4000);
  if (!n) return true;
  let onGrid = 0;
  for (let i = 0; i < n; i++) {
    const r = s.notes[i].start / QUANT;
    if (Math.abs(r - Math.round(r)) * QUANT < 0.02) onGrid++;
  }
  return onGrid / n >= 0.9;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

// ---- voices --------------------------------------------------------------

interface VoicePreset {
  harmonics: [mult: number, amp: number][]; // partial multipliers + amplitudes
  peak: number; // envelope peak, pre-master
}

// Additive recipes for the melody voice, selectable from the Studio rack. Kept
// deliberately lean: a full multi-channel arrangement plays many notes at once,
// so each voice uses few oscillators and a modest peak, leaning on the master
// compressor to glue the mix. "square" matches the original fixed preset, so
// the default mix is unchanged.
export type WaveKey = "sine" | "square" | "saw" | "organ";
const WAVES: Record<WaveKey, [number, number][]> = {
  sine: [[1, 1]],
  square: [[1, 1], [3, 1 / 3]], // odd harmonics approximate a square's brightness
  saw: [[1, 1], [2, 1 / 2], [3, 1 / 3], [4, 1 / 4]],
  organ: [[0.5, 0.6], [1, 1], [2, 0.6], [4, 0.35]], // drawbar-ish, with a 16' sub
};

const MELODY_PEAK = 0.4;
const BASS: VoicePreset = { harmonics: [[1, 1]], peak: 0.42 };
const KICK_PEAK = 0.32;
const SNARE_PEAK = 0.18;
const HAT_PEAK = 0.1;
// Notes at or below this MIDI number (C3) use the bass voice, the rest the
// melody voice — a crude but effective split for a typical pop arrangement.
export const BASS_MAX_PITCH = 48;

// ---- tweakable state ------------------------------------------------------

// The Studio's synth rack. Read at schedule time, so edits land within the
// lookahead window. Defaults reproduce the pre-Studio sound (velSens is the
// one deliberate exception: MIDI velocity now shapes loudness by default,
// which every bundled song benefits from).
export interface SynthParams {
  wave: VoiceKey; // the "auto" melody voice — any concrete patch, not just tables
  attack: number; // seconds (both pitched voices)
  release: number; // 0..1, scales the note-length decay target
  oct: number; // pitched-voice octave shift, -2..+2 (integer)
  detune: number; // unison detune in cents; >0 doubles every partial into a ± pair
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

export const PARAM_DEFAULTS: SynthParams = {
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

const params: SynthParams = { ...PARAM_DEFAULTS };

export function getParams(): SynthParams {
  return params;
}

export function setParam<K extends keyof SynthParams>(key: K, value: SynthParams[K]): void {
  params[key] = value;
  if (ctx) {
    const now = ctx.currentTime;
    if (key === "cutoff" && filter) filter.frequency.setTargetAtTime(params.cutoff, now, 0.03);
    if (key === "echo" && echoSend) echoSend.gain.setTargetAtTime(params.echo * 0.55, now, 0.03);
    if (key === "verb" && verbSend) verbSend.gain.setTargetAtTime(params.verb * 0.5, now, 0.03);
    if (key === "vib" && vibDepth) vibDepth.gain.setTargetAtTime(params.vib, now, 0.03);
    if (key === "drive" && driveShaper) driveShaper.curve = driveCurve(params.drive);
    if (key === "crush" && crushShaper) crushShaper.curve = crushCurve(params.crush);
    if (key === "echoDiv") syncDelayTime();
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
  const levels = Math.pow(2, bits - 1);
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}

// Per-strip instrument patches. "auto" is the legacy behavior: bass voice
// below C3, the global wave-table voice above. Everything else pins the whole
// strip to one synth — additive tables, a band-limited pulse, two 2-op FM
// voices, a pluck, and a pad. Read at schedule time like every other param.
export type PatchKey =
  | "auto" | "sine" | "square" | "saw" | "organ"
  | "pulse" | "epiano" | "bell" | "pluck" | "pad";

// Any concrete voice — what a strip pins itself to, and what the global
// Synth-section selector picks for "auto" strips' melody register.
export type VoiceKey = Exclude<PatchKey, "auto">;

export const PATCHES: { key: PatchKey; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "sine", label: "Sine" },
  { key: "square", label: "Square" },
  { key: "saw", label: "Saw" },
  { key: "organ", label: "Organ" },
  { key: "pulse", label: "Pulse" },
  { key: "epiano", label: "E-Piano" },
  { key: "bell", label: "Bell" },
  { key: "pluck", label: "Pluck" },
  { key: "pad", label: "Pad" },
];

// Per-strip mixer state. The returned object is live — the Studio mutates it
// directly and the scheduler reads it at note time.
export interface ChannelStrip {
  gain: number; // 0..1.5
  muted: boolean;
  solo: boolean;
  patch: PatchKey;
}

const strips = new Map<number, ChannelStrip>();

// When a song's pitched material all lives on one MIDI channel (solo-piano
// style arrangements), the engine's bass/melody voice split is the only
// "multitrack" structure there is — expose it as two strips so the mixer
// matches what you hear. Recomputed whenever the active song changes.
let splitVoices = false;

function computeSplitVoices(s: MidiSong): boolean {
  const pitched = new Set<number>();
  for (const n of s.notes) if (n.channel !== 9) pitched.add(n.channel);
  return pitched.size === 1;
}

// Mixer-strip key for a note: normally its MIDI channel; under the voice
// split, the lone channel's bass register gets a strip of its own.
function stripKey(channel: number, pitch: number): number {
  if (channel !== 9 && splitVoices && pitch < BASS_MAX_PITCH) return 256 | channel;
  return channel;
}

// A note's strip assignment, frozen the first time the note is seen (the
// Studio groups its track strips from the same memo). Live transposition
// mutates pitch in place — without the freeze, dragging a split-voice note
// across the bass boundary would re-route it to a different strip than the
// one it displays and dims under.
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

// Effective strip gain under the mute/solo matrix: any solo silences every
// non-soloed strip, mute always wins.
function stripGain(key: number, anySolo: boolean): number {
  const s = strips.get(key);
  if (!s) return anySolo ? 0 : 1;
  if (s.muted) return 0;
  if (anySolo && !s.solo) return 0;
  return s.gain;
}

// Play/stop + param changes notify subscribers (the top panel keeps its
// play glyph in sync with the Studio transport and vice versa).
type Listener = () => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

// ---- module state ----------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let echoSend: GainNode | null = null;
let delayNode: DelayNode | null = null;
let verbSend: GainNode | null = null;
let driveShaper: WaveShaperNode | null = null;
let crushShaper: WaveShaperNode | null = null;
let vibDepth: GainNode | null = null; // LFO → this → every oscillator's detune
let playing = false;
let starting = false; // guards the async gap in toggle() so two fast clicks can't double-start
let level = 62; // 0..100, mirrors the slider's initial value
let muted = false;
let noiseBuf: AudioBuffer | null = null;

// Every scheduled source (oscillators and noise buffer sources) so stop can halt
// them all; each is dropped on its own "ended" event.
const voices = new Set<AudioScheduledSourceNode>();

// MIDI source + streaming-playback state. The playlist is a list of .mid
// URLs; display names are deliberately anonymous ("Track 1") so what each one
// is stays a surprise until you press play. Parsed songs are cached per URL,
// so flipping back to a track is instant (and keeps its note edits — both are
// session-only anyway).
let playlist: string[] = [];
let trackIdx = 0;
const songCache = new Map<string, Promise<MidiSong | null>>();
let song: MidiSong | null = null;
let lookahead: ReturnType<typeof setInterval> | null = null;
let loopBase = 0; // ctx time at which the current iteration's beat 0 sounds
let loopDurSec = 0; // length of one full pass through the song, in seconds
let noteIdx = 0; // index into song.notes already scheduled this iteration
let secPerBeat = 0.5;
let bpmOverride: number | null = null; // Studio override; null = the file's tempo
let pausedAt = 0; // beats; where pause left off / where a stopped-state seek points

// Point the player at the bundled MIDI playlist; each entry is fetched lazily
// on its first play/selection.
export function configure(urls: string[]): void {
  playlist = urls.filter(Boolean);
  trackIdx = 0;
}

function loadSong(): Promise<MidiSong | null> {
  const url = playlist[trackIdx];
  if (!url) return Promise.resolve(null);
  let p = songCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => parseMidi(buf))
      .catch(() => null);
    songCache.set(url, p);
    // Don't cache a failure: evict so the next play/selection retries the
    // fetch instead of pinning the track dead for the whole session.
    void p.then((s) => {
      if (s === null) songCache.delete(url);
    });
  }
  return p.then((s) => {
    // A stale resolve (the user switched tracks mid-fetch) must not clobber
    // the engine's active song.
    if (url === playlist[trackIdx]) {
      song = s;
      quantizeActive = s ? computeQuantize(s) : true;
      splitVoices = s ? computeSplitVoices(s) : false;
    }
    return s;
  });
}

// The active track's parsed song, fetching it on first call. The returned
// object is the live playback source — the Studio's piano roll renders it and
// note edits (transposition) mutate it in place, audible on the next pass of
// the scheduler. Resolves null if the MIDI fails to load.
export function getSong(): Promise<MidiSong | null> {
  return loadSong();
}

export function trackIndex(): number {
  return trackIdx;
}

export function trackCount(): number {
  return playlist.length;
}

// Switch the active playlist entry (wraps around). Playback state carries
// over — a playing player starts the new song from the top. The mixer strips
// and tempo override reset (they're per-song), while the synth/FX params
// persist as the user's sound design.
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

// Perceptual but kept comfortably below full scale so the loop is never
// startling. Squaring the normalized level tracks loudness better than a linear
// map; the master compressor catches any stray peaks. Muted is silent.
function masterGain(): number {
  if (muted) return 0;
  const norm = level / 100;
  return norm * norm * 0.5;
}

function applyGain(): void {
  if (master && ctx) master.gain.setTargetAtTime(masterGain(), ctx.currentTime, 0.02);
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
  // The shared vibrato LFO sums into every oscillator's detune; its depth
  // gain is live, so the VIB knob shapes already-ringing notes too.
  vibDepth?.connect(osc.detune);
  const g = audio.createGain();
  g.gain.value = gainVal;
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur);
  trackSource(osc);
}

// A pitched note: one shared envelope gain feeds the master, every harmonic
// oscillator feeds that gain. Normalizing by the amplitude sum bounds the
// in-phase peak before the envelope and master gain. `gf` is the channel
// strip's gain; attack/release come from the live params.
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
    // Unison: a second oscillator per partial, detuned the other way — the
    // beat between the pair is the classic analog chorus thickener.
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
  return 440 * Math.pow(2, (pitch - 69) / 12);
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

// One pulse oscillator (a ± unison pair under DET) through the standard
// envelope — the chip lead.
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
    vibDepth?.connect(osc.detune);
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
// frequency. ratio/index/decay distinguish the e-piano from the bell; the
// bell rings past the written note length.
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
  vibDepth?.connect(car.detune);
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
// tick on the front — plucky regardless of the written duration.
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

// Slow-attack detuned saw-ish wash; the global DET adds on top of its own.
// The oscillators always outlive the attack ramp (staccato notes would
// otherwise hard-stop mid-swell with an audible click).
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
// kit (mapped to kick/snare/hat by note number); everything else dispatches on
// the strip's instrument patch — "auto" being the classic split: bass preset
// below C3, the globally-selected voice above.
function renderNote(audio: AudioContext, out: AudioNode, n: MidiNote, t: number, dur: number, gf: number): void {
  if (n.channel === 9) {
    // Drum pan positions are fixed kit placements, not GM note numbers.
    if (n.pitch === 35 || n.pitch === 36) scheduleKick(audio, panned(audio, out, 60), t, gf);
    else if (n.pitch === 38 || n.pitch === 40) scheduleNoise(audio, panned(audio, out, 54), t, 1800, SNARE_PEAK * gf, 0.12);
    else scheduleNoise(audio, panned(audio, out, 68), t, 7000, HAT_PEAK * gf, 0.05);
    return;
  }
  const freq = freqOf(n.pitch) * Math.pow(2, clamp(Math.round(params.oct), -2, 2));
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

// Lookahead: schedule every note whose (quantized) onset falls within the next
// ~0.2s, then loop once the iteration's notes are exhausted and the clock has
// passed the song's end.
function pump(audio: AudioContext, out: AudioNode): void {
  if (!song) return;
  const horizon = audio.currentTime + 0.2;
  const notes = song.notes;
  let anySolo = false;
  for (const s of strips.values()) if (s.solo) { anySolo = true; break; }
  while (noteIdx < notes.length) {
    const n = notes[noteIdx];
    const base = loopBase + swungStart(n.start) * secPerBeat;
    if (base > horizon) break;
    if (n.dead) { noteIdx++; continue; } // muted from the piano roll
    let gf = stripGain(noteStripKey(n), anySolo);
    if (gf > 0) {
      // Velocity sensitivity blends flat loudness toward the file's dynamics;
      // humanize adds per-note timing slop and level wobble on top.
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

// First note index at or past `beat` (notes are start-sorted), so a resume or
// seek doesn't replay everything before the entry point.
function noteIndexAt(beat: number): number {
  if (!song) return 0;
  let i = 0;
  const notes = song.notes;
  while (i < notes.length && notes[i].start < beat) i++;
  return i;
}

function startPlayer(audio: AudioContext, out: AudioNode): void {
  secPerBeat = 60 / bpm();
  loopDurSec = song!.durationBeats * secPerBeat;
  // Resume from wherever pause/seek left the transport (0 after a hard stop).
  const startBeat = clamp(pausedAt, 0, song!.durationBeats);
  loopBase = audio.currentTime + 0.1 - startBeat * secPerBeat;
  noteIdx = noteIndexAt(startBeat);
  syncDelayTime();
  pump(audio, out);
  lookahead = setInterval(() => pump(audio, out), 40);
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
      // Already stopped/ended; ignore.
    }
  }
  voices.clear();
}

function stopPlayback(): void {
  stopVoices();
  playing = false;
  emit();
}

// Decaying stereo noise burst — a perfectly serviceable small-room impulse
// for the convolver, generated instead of shipped.
function impulseBuffer(audio: AudioContext): AudioBuffer {
  const len = Math.floor(audio.sampleRate * 1.6);
  const buf = audio.createBuffer(2, len, audio.sampleRate);
  for (let chn = 0; chn < 2; chn++) {
    const data = buf.getChannelData(chn);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

// Lazily build the context + mix chain on the first user gesture:
// master gain → lowpass → drive → crush, then dry into the compressor plus
// two post-everything sends (tempo-synced feedback delay, convolver reverb)
// so echoes and tails inherit the cutoff and the dirt. A null WaveShaper
// curve is a pass-through, so the off positions cost nothing.
function ensureChain(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = 0.9;
  driveShaper = ctx.createWaveShaper();
  driveShaper.oversample = "2x";
  driveShaper.curve = driveCurve(params.drive);
  crushShaper = ctx.createWaveShaper();
  crushShaper.oversample = "2x";
  crushShaper.curve = crushCurve(params.crush);
  const comp = ctx.createDynamicsCompressor(); // safety limiter on the mix
  master.connect(filter);
  filter.connect(driveShaper);
  driveShaper.connect(crushShaper);
  const post = crushShaper;
  post.connect(comp);
  echoSend = ctx.createGain();
  echoSend.gain.value = params.echo * 0.55;
  delayNode = ctx.createDelay(2);
  delayNode.delayTime.value = params.echoDiv * secPerBeat;
  const fb = ctx.createGain();
  fb.gain.value = 0.42;
  post.connect(echoSend);
  echoSend.connect(delayNode);
  delayNode.connect(fb);
  fb.connect(delayNode);
  delayNode.connect(comp);
  verbSend = ctx.createGain();
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
  vibDepth = ctx.createGain();
  vibDepth.gain.value = params.vib;
  lfo.connect(vibDepth);
  lfo.start();
  comp.connect(ctx.destination);
  return ctx;
}

// Tempo-synced echo tap (1/8, dotted 1/8, or 1/4 by the TIME selector).
// Re-synced on BPM and division changes.
function syncDelayTime(): void {
  if (delayNode && ctx) delayNode.delayTime.setTargetAtTime(params.echoDiv * secPerBeat, ctx.currentTime, 0.05);
}

// Start/stop playback. Resolves to the new playing state. The context is created
// on first call (user gesture) and resumed in case it starts suspended; if it
// stays suspended (some mobile/embedded browsers) or the MIDI fails to load,
// report not-playing so the UI doesn't claim sound that isn't there.
export async function toggle(): Promise<boolean> {
  if (playing) {
    pausedAt = positionBeats(); // pause, not stop: resume picks up here
    stopPlayback();
    return false;
  }
  if (starting) return false; // an earlier click is already mid-start; ignore this one
  starting = true;
  try {
    if (!ensureChain()) return false;
    master!.gain.value = masterGain();
    await ctx!.resume();
    if (ctx!.state !== "running") return false;
    const loaded = await loadSong();
    if (!loaded) return false; // MIDI failed to load
    // selectTrack() may have switched the playlist entry while the fetch was
    // in flight (its stale-guard leaves `song` null in that case). Starting
    // the player on the orphaned result would deref a null song — stay
    // paused instead; the switch already emitted the consistent state.
    if (loaded !== song) return false;
    playing = true;
    startPlayer(ctx!, master!);
    emit();
    return true;
  } finally {
    starting = false;
  }
}

// Hard stop for the Studio transport: rewinds to the top, unlike toggle()'s
// pause/resume. Emits even when already paused so the playhead UI rewinds too.
export function stop(): void {
  pausedAt = 0;
  if (playing) stopPlayback();
  else emit();
}

export function isPlaying(): boolean {
  return playing;
}

// Anonymous display label — the playlist never exposes real song names.
export function trackName(): string {
  return playlist.length ? `Track ${trackIdx + 1}` : "";
}

// The active tempo: the Studio override if set, else the file's tempo.
export function bpm(): number {
  return bpmOverride ?? song?.bpm ?? 120;
}

export function songBpm(): number {
  return song?.bpm ?? 120;
}

// Override the tempo, reanchoring the loop so the playhead doesn't jump:
// the current beat stays the current beat, only the beat length changes.
// Notes already scheduled (≤0.2s ahead) ride out at the old timing.
export function setBpm(value: number): void {
  bpmOverride = clamp(Math.round(value), 40, 240);
  if (ctx && playing && song) {
    const now = ctx.currentTime;
    const beat = (now - loopBase) / secPerBeat;
    secPerBeat = 60 / bpmOverride;
    loopBase = now - beat * secPerBeat;
    loopDurSec = song.durationBeats * secPerBeat;
    syncDelayTime();
  }
  emit();
}

// Playhead position in beats into the current loop. While paused/stopped this
// is the resume point (pause position, seek target, or 0 after a hard stop).
export function positionBeats(): number {
  if (!ctx || !playing || !song) return pausedAt;
  return clamp((ctx.currentTime - loopBase) / secPerBeat, 0, song.durationBeats);
}

// Jump the transport to an absolute beat. Mid-playback this cuts every voice
// (scheduled lookahead included — they'd be echoes of the old position) and
// re-anchors the loop; the pump refills from the new spot on its next tick.
// While paused it just moves the resume point.
export function seek(beats: number): void {
  if (!song) return;
  const b = clamp(beats, 0, song.durationBeats);
  pausedAt = b;
  if (ctx && playing) {
    for (const v of voices) {
      try {
        v.stop();
      } catch {
        // Already stopped/ended; ignore.
      }
    }
    voices.clear();
    loopBase = ctx.currentTime + 0.06 - b * secPerBeat;
    noteIdx = noteIndexAt(b);
  }
  emit();
}

// One-shot note preview through the live chain (piano-roll clicks and
// transpose drags). Creates/resumes the context — callers are user gestures.
export function auditionNote(pitch: number, channel = 0): void {
  const audio = ensureChain();
  if (!audio || !master) return;
  const out = master;
  master.gain.value = masterGain();
  void audio.resume().then(() => {
    if (audio.state !== "running") return;
    const t = audio.currentTime + 0.02;
    const n: MidiNote = { channel, pitch, start: 0, dur: 0, vel: 0.9 };
    // Full gain regardless of the mixer: a preview should always be audible.
    renderNote(audio, out, n, t, 0.35, 1);
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
