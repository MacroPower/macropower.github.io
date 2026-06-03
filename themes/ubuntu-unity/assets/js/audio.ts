// Web Audio MIDI player for the volume dropdown. Self-contained:
// all audio state lives in module scope, nothing is persisted, and no globals
// are touched — same session-only style as prefs.ts. The AudioContext is created
// lazily on the first play click, so the user gesture satisfies the browser's
// autoplay policy and nothing autoplays.
//
// `configure(url, name)` points it at a bundled .mid; on first play the file is
// fetched and parsed (midi.ts), then streamed: a setInterval lookahead schedules
// notes a fraction of a second ahead of the audio clock and loops at the end.
// Every pitched note is voiced additively from plain "sine" oscillators (built-in
// "square"/"triangle" types are silent in some Firefox builds); the GM drum
// channel (9) is rendered with a synthesized kick/snare/hat. The whole mix runs
// through a compressor to tame peaks.

import { parseMidi, type MidiNote, type MidiSong } from "./midi";

// Quantize note onsets/durations to this beat grid (a sixteenth note) so a
// loosely-played MIDI lands on a tidy grid.
const QUANT = 0.25;
const quant = (beats: number): number => Math.round(beats / QUANT) * QUANT;

interface VoicePreset {
  harmonics: [mult: number, amp: number][]; // odd harmonics approximate a square's brightness
  peak: number; // envelope peak, pre-master
  attack: number; // seconds
}

// Kept deliberately lean: a full multi-channel arrangement plays many notes at
// once, so each voice uses few oscillators and a modest peak, leaning on the
// master compressor to glue the mix.
const MELODY: VoicePreset = { harmonics: [[1, 1], [3, 1 / 3]], peak: 0.4, attack: 0.008 };
const BASS: VoicePreset = { harmonics: [[1, 1]], peak: 0.42, attack: 0.012 };
const KICK_PEAK = 0.32;
const SNARE_PEAK = 0.18;
const HAT_PEAK = 0.1;
// Notes at or below this MIDI number (C3) use the bass voice, the rest the
// melody voice — a crude but effective split for a typical pop arrangement.
const BASS_MAX_PITCH = 48;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let playing = false;
let starting = false; // guards the async gap in toggle() so two fast clicks can't double-start
let level = 62; // 0..100, mirrors the slider's initial value
let muted = false;
let noiseBuf: AudioBuffer | null = null;

// Every scheduled source (oscillators and noise buffer sources) so stop can halt
// them all; each is dropped on its own "ended" event.
const voices = new Set<AudioScheduledSourceNode>();

// MIDI source + streaming-playback state.
let midiUrl = "";
let trackTitle = "";
let song: MidiSong | null = null;
let loadPromise: Promise<MidiSong | null> | null = null;
let lookahead: ReturnType<typeof setInterval> | null = null;
let loopBase = 0; // ctx time at which the current iteration's beat 0 sounds
let loopDurSec = 0; // length of one full pass through the song, in seconds
let noteIdx = 0; // index into song.notes already scheduled this iteration
let secPerBeat = 0.5;

// Point the player at a MIDI to fetch on first play; `name` is the display label.
export function configure(url: string, name = ""): void {
  midiUrl = url;
  trackTitle = name;
}

function loadSong(): Promise<MidiSong | null> {
  if (song) return Promise.resolve(song);
  if (!midiUrl) return Promise.resolve(null);
  if (!loadPromise) {
    loadPromise = fetch(midiUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => { song = parseMidi(buf); return song; })
      .catch(() => null);
  }
  return loadPromise;
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

function addOsc(audio: AudioContext, hz: number, gainVal: number, dest: AudioNode, t: number, dur: number): void {
  if (hz >= audio.sampleRate / 2) return; // skip above Nyquist
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.value = hz;
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
// in-phase peak before the envelope and master gain.
function scheduleTone(audio: AudioContext, out: AudioNode, t: number, freq: number, dur: number, p: VoicePreset): void {
  const env = audio.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(p.peak, t + p.attack);
  env.gain.linearRampToValueAtTime(0.001, t + dur * 0.9);
  env.connect(out);
  const norm = p.harmonics.reduce((s, [, a]) => s + a, 0);
  for (const [mult, amp] of p.harmonics) addOsc(audio, freq * mult, amp / norm, env, t, dur);
}

function scheduleKick(audio: AudioContext, out: AudioNode, t: number): void {
  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(KICK_PEAK, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + 0.2);
  trackSource(osc);
}

function scheduleNoise(audio: AudioContext, out: AudioNode, t: number, hp: number, peak: number, decay: number): void {
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

// Render one MIDI note at absolute context time `t`. Channel 9 is the GM drum
// kit (mapped to kick/snare/hat by note number); everything else is pitched and
// voiced with the bass preset down low, the melody preset higher up.
function renderNote(audio: AudioContext, out: AudioNode, n: MidiNote, t: number, dur: number): void {
  if (n.channel === 9) {
    if (n.pitch === 35 || n.pitch === 36) scheduleKick(audio, out, t);
    else if (n.pitch === 38 || n.pitch === 40) scheduleNoise(audio, out, t, 1800, SNARE_PEAK, 0.12);
    else scheduleNoise(audio, out, t, 7000, HAT_PEAK, 0.05);
    return;
  }
  scheduleTone(audio, out, t, freqOf(n.pitch), dur, n.pitch < BASS_MAX_PITCH ? BASS : MELODY);
}

// Lookahead: schedule every note whose (quantized) onset falls within the next
// ~0.2s, then loop once the iteration's notes are exhausted and the clock has
// passed the song's end.
function pump(audio: AudioContext, out: AudioNode): void {
  if (!song) return;
  const horizon = audio.currentTime + 0.2;
  const notes = song.notes;
  while (noteIdx < notes.length) {
    const n = notes[noteIdx];
    const t = loopBase + quant(n.start) * secPerBeat;
    if (t > horizon) break;
    renderNote(audio, out, n, t, Math.max(0.05, quant(n.dur) * secPerBeat));
    noteIdx++;
  }
  if (noteIdx >= notes.length && audio.currentTime >= loopBase + loopDurSec) {
    loopBase += loopDurSec;
    noteIdx = 0;
  }
}

function startPlayer(audio: AudioContext, out: AudioNode): void {
  secPerBeat = 60 / song!.bpm;
  loopDurSec = song!.durationBeats * secPerBeat;
  loopBase = audio.currentTime + 0.1;
  noteIdx = 0;
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
}

// Start/stop playback. Resolves to the new playing state. The context is created
// on first call (user gesture) and resumed in case it starts suspended; if it
// stays suspended (some mobile/embedded browsers) or the MIDI fails to load,
// report not-playing so the UI doesn't claim sound that isn't there.
export async function toggle(): Promise<boolean> {
  if (playing) {
    stopPlayback();
    return false;
  }
  if (starting) return false; // an earlier click is already mid-start; ignore this one
  starting = true;
  try {
    if (!ctx) {
      const AC = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor(); // safety limiter on the mix
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    master!.gain.value = masterGain();
    await ctx.resume();
    if (ctx.state !== "running") return false;
    const loaded = await loadSong();
    if (!loaded) return false; // MIDI failed to load
    playing = true;
    startPlayer(ctx, master!);
    return true;
  } finally {
    starting = false;
  }
}

export function isPlaying(): boolean {
  return playing;
}

export function trackName(): string {
  return trackTitle;
}

export function setVolume(level0to100: number): void {
  level = level0to100;
  applyGain();
}

export function setMuted(on: boolean): void {
  muted = on;
  applyGain();
}
