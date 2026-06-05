// The Studio window — a tiny period-correct DAW (think LMMS on 14.04) over the
// audio.ts engine. Owns the window's open/minimize/close state machine and
// launcher-tile cycle (mirroring trash.ts), and builds the whole instrument
// surface client-side from the parsed MIDI: track strips with mute/solo/level,
// a synth rack of rotary knobs, a draggable BPM LCD, and a canvas piano roll
// with a live playhead. Notes are the engine's own objects, so dragging one
// vertically transposes the actual playback within the scheduler's lookahead.
//
// Everything here is session-only — window position, knob values, and note
// edits all reset on reload (knob/note state lives in audio.ts and the shared
// MidiSong; nothing is persisted).

import * as audio from "./audio";
import { installTitlebarDrag } from "./drag";
import { setStudioFocused, getStudioFocused, subscribe } from "./focus";
import type { MidiNote, MidiSong } from "./midi";
import { installResize } from "./resize";

// ---- piano-roll geometry ----------------------------------------------------

const KEYS_W = 46; // sticky key column
const RULER_H = 20; // sticky bar ruler
const ROW_H = 10; // one semitone
const DRUM_GAP = 7; // band between the pitched grid and the drum lane
const ZOOMS = [12, 18, 26, 38, 56]; // px per beat
const PITCH_MIN = 21; // A0
const PITCH_MAX = 108; // C8
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

const ACCENT = "#E95420"; // playhead — Unity orange, deliberately not themed
const DRUM_ROWS = [
  { label: "hat", pitch: 42 },
  { label: "snr", pitch: 38 },
  { label: "kck", pitch: 36 },
];

function noteName(pitch: number): string {
  return NOTE_NAMES[pitch % 12] + String(Math.floor(pitch / 12) - 1);
}

// ---- track model ------------------------------------------------------------

interface Track {
  channel: number; // MIDI channel (9 = drums); the bass half of a voice split shares its channel
  name: string;
  color: string;
  notes: MidiNote[];
  strip: audio.ChannelStrip;
}

const KEYS_COLORS = ["#E8C25A", "#B98AE8", "#5AC8C0", "#E8975A"];

// Group the flat note list by mixer-strip key (the MIDI channel, except that
// a single-channel song splits into its bass/lead voices — audio.stripKey)
// and give each strip a DAW-ish identity: channel 9 is the GM kit, the
// lowest-pitched melodic strip reads as the bassline, the highest as the
// lead, anything between as keys.
function deriveTracks(song: MidiSong): Track[] {
  const byKey = new Map<number, MidiNote[]>();
  for (const n of song.notes) {
    const key = audio.noteStripKey(n); // frozen per note — see audio.ts
    let arr = byKey.get(key);
    if (!arr) { arr = []; byKey.set(key, arr); }
    arr.push(n);
  }
  const pitched = [...byKey.entries()].filter(([key]) => (key & 0xff) !== 9);
  pitched.sort((a, b) => avgPitch(a[1]) - avgPitch(b[1]));

  const tracks: Track[] = [];
  let keysIdx = 0;
  pitched.forEach(([key, notes], i) => {
    let name: string;
    let color: string;
    if (pitched.length > 1 && i === 0) { name = "Bass"; color = "#5AA7E8"; }
    else if (i === pitched.length - 1) { name = "Lead"; color = "#6FE07C"; }
    else {
      name = pitched.length > 3 ? `Keys ${keysIdx + 1}` : "Keys";
      color = KEYS_COLORS[keysIdx % KEYS_COLORS.length];
      keysIdx++;
    }
    tracks.push({ channel: key & 0xff, name, color, notes, strip: audio.strip(key) });
  });
  const drums = byKey.get(9);
  if (drums) tracks.push({ channel: 9, name: "Drums", color: "#E8625A", notes: drums, strip: audio.strip(9) });
  return tracks;
}

function avgPitch(notes: MidiNote[]): number {
  let s = 0;
  for (const n of notes) s += n.pitch;
  return notes.length ? s / notes.length : 60;
}

// ---- knobs -------------------------------------------------------------------

interface KnobSpec {
  label: string;
  min: number;
  max: number;
  value: number;
  preset: number; // double-click restores this
  log?: boolean;
  step?: number; // snap values to this increment (e.g. octave knob)
  small?: boolean;
  fmt: (v: number) => string;
  onInput: (v: number) => void;
}

// A rotary knob: 270° sweep, drag up/down (or scroll / arrow keys) to turn,
// double-click to reset. The dial's pointer and value arc render purely from
// the --rot / --arc custom properties; the readout below is a mini LCD.
function makeKnob(spec: KnobSpec): HTMLElement {
  const root = document.createElement("div");
  root.className = "up-daw-knob" + (spec.small ? " is-sm" : "");
  const dial = document.createElement("div");
  dial.className = "up-daw-knob-dial";
  dial.tabIndex = 0;
  dial.setAttribute("role", "slider");
  dial.setAttribute("aria-label", spec.label);
  dial.setAttribute("aria-valuemin", String(spec.min));
  dial.setAttribute("aria-valuemax", String(spec.max));
  const label = document.createElement("span");
  label.className = "up-daw-knob-label";
  label.textContent = spec.label;
  const value = document.createElement("span");
  value.className = "up-daw-knob-value";
  root.append(dial, label, value);

  // `cur` stays continuous even on stepped knobs — snapping happens only at
  // the output/display edge, so slow drags and small wheel/key nudges
  // accumulate instead of being rounded away each event.
  let cur = spec.value;
  const snap = (v: number): number => spec.step ? Math.round(v / spec.step) * spec.step : v;
  let lastOut = snap(spec.value);

  const toNorm = (v: number): number => spec.log
    ? Math.log(v / spec.min) / Math.log(spec.max / spec.min)
    : (v - spec.min) / (spec.max - spec.min);
  const fromNorm = (n: number): number => spec.log
    ? spec.min * Math.pow(spec.max / spec.min, n)
    : spec.min + n * (spec.max - spec.min);

  const paint = (): void => {
    const sv = snap(cur);
    const n = Math.min(Math.max(toNorm(sv), 0), 1);
    dial.style.setProperty("--rot", `${-135 + n * 270}deg`);
    dial.style.setProperty("--arc", `${n * 270}deg`);
    dial.setAttribute("aria-valuenow", String(sv));
    dial.setAttribute("aria-valuetext", spec.fmt(sv));
    value.textContent = spec.fmt(sv);
    // Small (track-strip) knobs hide the readout; surface it as a tooltip.
    if (spec.small) dial.title = spec.fmt(sv);
  };

  const set = (v: number, fire = true): void => {
    cur = Math.min(Math.max(v, spec.min), spec.max);
    paint();
    const sv = snap(cur);
    if (fire && sv !== lastOut) {
      lastOut = sv;
      spec.onInput(sv);
    }
  };
  const nudge = (deltaNorm: number): void => {
    set(fromNorm(Math.min(Math.max(toNorm(cur) + deltaNorm, 0), 1)));
  };
  // Discrete inputs move stepped knobs by at least one whole step per event.
  const notch = (base: number): number => {
    if (!spec.step) return base;
    return Math.max(base, spec.step / (spec.max - spec.min));
  };

  dial.addEventListener("mousedown", (e) => {
    e.preventDefault();
    dial.focus();
    let lastY = e.clientY;
    document.body.classList.add("up-daw-turning");
    const move = (ev: MouseEvent): void => {
      const dy = lastY - ev.clientY;
      lastY = ev.clientY;
      if (dy !== 0) nudge(dy * 0.006);
    };
    const up = (): void => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("up-daw-turning");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
  dial.addEventListener("dblclick", () => set(spec.preset));
  dial.addEventListener("wheel", (e) => {
    e.preventDefault();
    nudge(e.deltaY < 0 ? notch(0.05) : -notch(0.05));
  }, { passive: false });
  dial.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); nudge(notch(0.03)); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); nudge(-notch(0.03)); }
    else if (e.key === "Home") { e.preventDefault(); set(spec.min); }
    else if (e.key === "End") { e.preventDefault(); set(spec.max); }
  });

  set(spec.value, false);
  return root;
}

const fmtPct = (v: number): string => `${Math.round(v * 100)}%`;
const fmtMs = (v: number): string => `${Math.round(v * 1000)}ms`;
const fmtHz = (v: number): string => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz`;
const fmtCents = (v: number): string => `${Math.round(v)}ct`;
const fmtSigned = (v: number): string => (v > 0 ? `+${v}` : String(v));

// 16x16 voice glyphs (currentColor, so the lit/custom tints apply): single
// cycles for the waveform voices, pictograms for the rest — stacked dual
// waves for Auto's bass/lead split, a keyboard, a bell, a plectrum, a cloud.
const PATCH_GLYPHS: Record<audio.PatchKey, string> = {
  auto: '<path d="M2 5 Q4.75 1.5 7.5 5 T13 5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 11.5 Q4.5 7.5 8 11.5 T15 11.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  sine: '<path d="M1 8 Q4.5 1 8 8 T15 8" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  square: '<path d="M1 12 V4 H8 V12 H15 V4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  saw: '<path d="M1 12 L8 4 V12 L15 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  organ: '<rect x="2" y="6" width="2.4" height="8" fill="currentColor"/><rect x="6.8" y="2" width="2.4" height="12" fill="currentColor"/><rect x="11.6" y="8" width="2.4" height="6" fill="currentColor"/>',
  pulse: '<path d="M1 12 V4 H5 V12 H15 V4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  epiano: '<rect x="1.7" y="3.7" width="12.6" height="8.6" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.9 8.4 V12 M10.1 8.4 V12" stroke="currentColor" stroke-width="1.1" fill="none"/><rect x="4.7" y="3.7" width="2.1" height="4.7" fill="currentColor"/><rect x="9.2" y="3.7" width="2.1" height="4.7" fill="currentColor"/>',
  bell: '<path d="M8 2.2 C5.4 2.2 4.3 4.6 4.3 7.2 C4.3 9.3 3.4 10.3 2.7 10.9 H13.3 C12.6 10.3 11.7 9.3 11.7 7.2 C11.7 4.6 10.6 2.2 8 2.2 Z" fill="currentColor"/><circle cx="8" cy="12.8" r="1.3" fill="currentColor"/>',
  pluck: '<path d="M8 13.8 C5.6 11.2 3.4 8.2 3.4 5.7 C3.4 3.6 5.4 2.4 8 2.4 C10.6 2.4 12.6 3.6 12.6 5.7 C12.6 8.2 10.4 11.2 8 13.8 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  pad: '<path d="M12 6.8 h-.9 A5.2 5.2 0 1 0 6 13.2 h6 a3.2 3.2 0 0 0 0-6.4 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
};

const patchSvg = (key: audio.PatchKey, size: number): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true">${PATCH_GLYPHS[key]}</svg>`;
const VOICE_FLAVOR: Partial<Record<audio.PatchKey, string>> = {
  sine: "pure",
  square: "the default",
  saw: "buzzy",
  organ: "drawbars and a sub",
  pulse: "chip lead",
  epiano: "FM tines",
  bell: "FM bell, rings past the note",
  pluck: "instant attack, fast decay",
  pad: "slow wash",
};

// ---- module wiring ------------------------------------------------------------

let openImpl: (() => void) | null = null;

// Open (or re-focus) the Studio window. Safe to call before initDaw on pages
// without the partial — it just no-ops.
export function openStudio(): void {
  openImpl?.();
}

export function initDaw(): void {
  const stage = document.querySelector<HTMLElement>('[data-up-window="daw"]');
  if (!stage) return;
  const chrome = stage.querySelector<HTMLElement>(".up-window-chrome");
  if (!chrome) return;

  const q = <T extends HTMLElement>(sel: string): T | null => chrome.querySelector<T>(sel);
  const titleEl = q("[data-daw-title]");
  const playBtn = q("[data-daw-play]");
  const stopBtn = q("[data-daw-stop]");
  const prevBtn = q("[data-daw-prev]");
  const nextBtn = q("[data-daw-next]");
  const trkLcd = q("[data-daw-trk]");
  const posLcd = q("[data-daw-pos]");
  const bpmLcd = q("[data-daw-bpm]");
  const zoomOutBtn = q("[data-daw-zoom-out]");
  const zoomInBtn = q("[data-daw-zoom-in]");
  const followBtn = q("[data-daw-follow]");
  const tracksHost = q("[data-daw-tracks]");
  const synthHost = q("[data-daw-synth]");
  const fxHost = q("[data-daw-fx]");
  const grooveHost = q("[data-daw-groove]");
  const roll = q("[data-daw-roll]");
  const canvas = q<HTMLCanvasElement>("[data-daw-canvas]");
  const scroller = q("[data-daw-scroller]");
  const spacer = q("[data-daw-spacer]");
  const loadingEl = q("[data-daw-loading]");
  const statusEl = q("[data-daw-status]");
  if (!roll || !canvas || !scroller || !spacer) return;

  const defaultStatus = statusEl?.textContent ?? "";

  // ---- window state machine (the trash.ts pattern + a running-app tile) ----

  let open = false;
  let minimized = false;
  let maximized = false;

  const launcherTile = document.querySelector<HTMLElement>('[data-launcher="studio"]');

  const syncLauncherTile = (): void => {
    if (!launcherTile) return;
    const running = open || minimized;
    launcherTile.hidden = !running;
    launcherTile.classList.toggle("is-active", running);
    launcherTile.classList.toggle("is-focused", open && !minimized && getStudioFocused());
  };

  const render = (): void => {
    const visible = open && !minimized;
    const focused = visible && getStudioFocused();
    stage.hidden = !visible;
    chrome.classList.toggle("is-focused", focused);
    // The stage class rides the shared .up-window-stage.is-focused z-index
    // raise, so the focused overlay window paints above the other (trash).
    stage.classList.toggle("is-focused", focused);
    syncLauncherTile();
  };

  const show = (): void => {
    open = true;
    minimized = false;
    setStudioFocused(true);
    render();
    void loadSurface(); // idempotent: early-returns while the surface matches
    startLoop();
    requestAnimationFrame(() => { sizeCanvas(); dirty = true; });
  };
  const hide = (): void => {
    open = false;
    minimized = false;
    setStudioFocused(false);
    render();
    stopLoop();
  };
  const minimize = (): void => {
    minimized = true;
    setStudioFocused(false);
    render();
    stopLoop();
  };

  // Maximize fills the desktop between the launcher and the top panel (the
  // is-maximized CSS overrides position/size and neutralizes the drag
  // transform); the ResizeObserver below re-fits the canvas on both legs.
  const toggleMaximize = (): void => {
    maximized = !maximized;
    stage.classList.toggle("is-maximized", maximized);
  };

  chrome.querySelector(".up-tl-close")?.addEventListener("click", (e) => { e.stopPropagation(); hide(); });
  chrome.querySelector(".up-tl-min")?.addEventListener("click", (e) => { e.stopPropagation(); minimize(); });
  chrome.querySelector(".up-tl-max")?.addEventListener("click", (e) => { e.stopPropagation(); toggleMaximize(); });
  chrome.querySelector("[data-titlebar]")?.addEventListener("dblclick", (e) => {
    const target = e.target as Element | null;
    if (target?.closest("button")) return;
    toggleMaximize();
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    if (!target?.closest('[data-launcher="studio"]')) return;
    e.preventDefault();
    if (!open || minimized) { show(); return; }
    if (getStudioFocused()) { minimize(); return; }
    setStudioFocused(true);
    render();
  });

  chrome.addEventListener("mousedown", () => {
    if (!getStudioFocused() && open && !minimized) {
      setStudioFocused(true);
      render();
    }
  });

  const drag = installTitlebarDrag(chrome, { spring: false, yMin: 24, gate: () => !maximized });
  subscribe(render);
  render();

  // Rack sections collapse Qt-groupbox-style so the full option set fits in
  // the rack on any window size (the rack itself scrolls as a fallback).
  chrome.querySelectorAll<HTMLElement>("[data-daw-collapse]").forEach((btn) => {
    btn.setAttribute("aria-expanded", "true");
    btn.addEventListener("click", () => {
      const collapsed = btn.closest(".up-daw-section")?.classList.toggle("is-collapsed") ?? false;
      btn.setAttribute("aria-expanded", String(!collapsed));
    });
  });

  openImpl = show;

  // ---- song + instrument surface -------------------------------------------

  let song: MidiSong | null = null;
  let tracks: Track[] = [];
  let pitchLo = 48;
  let pitchHi = 84;
  let hasDrums = false;
  let zoomIdx = 2;
  let follow = true;
  let dirty = true;
  let raf = 0;
  let programmaticScroll = false;
  let dpr = 1;

  const pxb = (): number => ZOOMS[zoomIdx];
  const rows = (): number => pitchHi - pitchLo + 1;
  const drumTop = (): number => RULER_H + rows() * ROW_H + DRUM_GAP;
  const contentW = (): number => song ? KEYS_W + Math.ceil(song.durationBeats + 4) * pxb() : 0;
  const contentH = (): number => drumTop() + (hasDrums ? DRUM_ROWS.length * ROW_H : 0) + 8;

  function showLoading(text: string): void {
    if (loadingEl) {
      loadingEl.hidden = false;
      loadingEl.textContent = text;
    }
  }

  // (Re)build the whole instrument surface for the active playlist entry.
  // Keyed on the track index so it's an idempotent no-op until the selection
  // actually changes (audio.onChange calls it on every emit). A switch
  // mid-fetch is safe: the newer call takes the surface and the older one
  // bails at the index check after its await.
  let surfaceIdx = -1;

  async function loadSurface(): Promise<void> {
    const idx = audio.trackIndex();
    if (idx === surfaceIdx) return;
    surfaceIdx = idx;
    const name = audio.trackName();
    if (titleEl) titleEl.textContent = name ? `${name} — Studio` : "Studio";
    song = null; // park the renderer while the surface swaps
    tracks = [];
    showLoading("Loading…");
    const loaded = await audio.getSong();
    if (audio.trackIndex() !== idx || surfaceIdx !== idx) return;
    if (!loaded || !loaded.notes.length) {
      showLoading("Couldn't load the song. The tape deck stays empty.");
      surfaceIdx = -1; // unlatch so the next interaction retries the load
      return;
    }
    song = loaded;
    tracks = deriveTracks(loaded);
    hasDrums = tracks.some((t) => t.channel === 9);

    let lo = 127;
    let hi = 0;
    for (const t of tracks) {
      if (t.channel === 9) continue;
      for (const n of t.notes) {
        if (n.pitch < lo) lo = n.pitch;
        if (n.pitch > hi) hi = n.pitch;
      }
    }
    pitchLo = Math.max(PITCH_MIN, Math.min(lo, hi) - 2);
    pitchHi = Math.min(PITCH_MAX, Math.max(lo, hi) + 2);

    if (loadingEl) loadingEl.hidden = true;
    buildRack();
    syncTransport();
    sizeContent();
    sizeCanvas();
    setScrollLeft(0);
    scroller!.scrollTop = 0;
    dirty = true;
  }

  function buildRack(): void {
    closePatchMenu(); // an open picker would reference the torn-down strips
    if (tracksHost) {
      tracksHost.replaceChildren(...tracks.map((t) => buildTrackStrip(t)));
    }
    if (synthHost) {
      // The global "auto" voice: every concrete patch, not just the tables.
      const waves = document.createElement("div");
      waves.className = "up-daw-waves";
      const buttons = new Map<audio.VoiceKey, HTMLButtonElement>();
      for (const p of audio.PATCHES) {
        if (p.key === "auto") continue;
        const key = p.key as audio.VoiceKey;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "up-daw-wave";
        const title = `${p.label} — ${VOICE_FLAVOR[key] ?? ""}`;
        b.title = title;
        b.setAttribute("aria-label", title);
        b.innerHTML = patchSvg(key, 16);
        b.addEventListener("click", () => {
          audio.setParam("wave", key);
          buttons.forEach((btn, k) => btn.classList.toggle("is-on", k === key));
        });
        buttons.set(key, b);
        waves.appendChild(b);
      }
      buttons.get(audio.getParams().wave)?.classList.add("is-on");
      const knobs = document.createElement("div");
      knobs.className = "up-daw-knobs";
      const p = audio.getParams();
      const D = audio.PARAM_DEFAULTS;
      knobs.append(
        makeKnob({
          label: "att", min: 0.001, max: 0.08, value: p.attack,
          preset: D.attack, fmt: fmtMs,
          onInput: (v) => audio.setParam("attack", v),
        }),
        makeKnob({
          label: "rel", min: 0.15, max: 1, value: p.release,
          preset: D.release, fmt: fmtPct,
          onInput: (v) => audio.setParam("release", v),
        }),
        makeKnob({
          label: "oct", min: -2, max: 2, step: 1, value: p.oct,
          preset: D.oct, fmt: fmtSigned,
          onInput: (v) => audio.setParam("oct", v),
        }),
        makeKnob({
          label: "det", min: 0, max: 30, value: p.detune,
          preset: D.detune, fmt: fmtCents,
          onInput: (v) => audio.setParam("detune", v),
        }),
        makeKnob({
          label: "vib", min: 0, max: 40, value: p.vib,
          preset: D.vib, fmt: fmtCents,
          onInput: (v) => audio.setParam("vib", v),
        }),
      );
      synthHost.replaceChildren(waves, knobs);
    }
    if (fxHost) {
      const p = audio.getParams();
      const D = audio.PARAM_DEFAULTS;
      const knobs = document.createElement("div");
      knobs.className = "up-daw-knobs";
      knobs.append(
        makeKnob({
          label: "cut", min: 200, max: 12000, value: p.cutoff,
          preset: D.cutoff, log: true, fmt: fmtHz,
          onInput: (v) => audio.setParam("cutoff", v),
        }),
        makeKnob({
          label: "drive", min: 0, max: 1, value: p.drive,
          preset: D.drive, fmt: fmtPct,
          onInput: (v) => audio.setParam("drive", v),
        }),
        makeKnob({
          label: "crush", min: 0, max: 1, value: p.crush,
          preset: D.crush, fmt: fmtPct,
          onInput: (v) => audio.setParam("crush", v),
        }),
        makeKnob({
          label: "echo", min: 0, max: 1, value: p.echo,
          preset: D.echo, fmt: fmtPct,
          onInput: (v) => audio.setParam("echo", v),
        }),
        makeKnob({
          label: "verb", min: 0, max: 1, value: p.verb,
          preset: D.verb, fmt: fmtPct,
          onInput: (v) => audio.setParam("verb", v),
        }),
        makeKnob({
          label: "width", min: 0, max: 1, value: p.width,
          preset: D.width, fmt: fmtPct,
          onInput: (v) => audio.setParam("width", v),
        }),
      );
      // Echo sync selector: the delay tap's musical division.
      const times = document.createElement("div");
      times.className = "up-daw-times";
      const timesLabel = document.createElement("span");
      timesLabel.className = "up-daw-times-label";
      timesLabel.textContent = "echo sync";
      times.appendChild(timesLabel);
      const timeBtns = new Map<number, HTMLButtonElement>();
      for (const { label, div } of [
        { label: "1/8", div: 0.5 },
        { label: "·8", div: 0.75 },
        { label: "1/4", div: 1 },
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "up-daw-time";
        b.textContent = label;
        b.title = `Echo: ${label === "·8" ? "dotted eighth" : label} note`;
        b.addEventListener("click", () => {
          audio.setParam("echoDiv", div);
          timeBtns.forEach((btn, d) => btn.classList.toggle("is-on", d === div));
        });
        timeBtns.set(div, b);
        times.appendChild(b);
      }
      timeBtns.get(p.echoDiv)?.classList.add("is-on");
      fxHost.replaceChildren(knobs, times);
    }
    if (grooveHost) {
      const p = audio.getParams();
      const D = audio.PARAM_DEFAULTS;
      grooveHost.replaceChildren(
        makeKnob({
          label: "swing", min: 0, max: 0.8, value: p.swing,
          preset: D.swing, fmt: fmtPct,
          onInput: (v) => audio.setParam("swing", v),
        }),
        makeKnob({
          label: "hum", min: 0, max: 1, value: p.humanize,
          preset: D.humanize, fmt: fmtPct,
          onInput: (v) => audio.setParam("humanize", v),
        }),
        makeKnob({
          label: "vel", min: 0, max: 1, value: p.velSens,
          preset: D.velSens, fmt: fmtPct,
          onInput: (v) => audio.setParam("velSens", v),
        }),
      );
    }
  }

  // One instrument popover at a time, anchored to the strip's patch button.
  // The anchor is tracked so the outside-mousedown closer leaves clicks on
  // the owning button alone — its click handler then toggles the menu shut
  // instead of racing a close-then-reopen.
  let patchMenu: HTMLElement | null = null;
  let patchMenuAnchor: HTMLElement | null = null;
  const closePatchMenu = (): void => {
    patchMenu?.remove();
    patchMenu = null;
    patchMenuAnchor = null;
  };
  document.addEventListener("mousedown", (e) => {
    if (!patchMenu) return;
    const t = e.target;
    if (t instanceof Node && (patchMenu.contains(t) || patchMenuAnchor?.contains(t))) return;
    closePatchMenu();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePatchMenu();
  });
  // Either scroller moving under an open menu would leave it mis-anchored.
  tracksHost?.addEventListener("scroll", closePatchMenu);
  chrome.querySelector(".up-daw-rack")?.addEventListener("scroll", closePatchMenu);

  // Edge/corner resize shares the drag's transform offset so north/west
  // resizes move the origin without the two fighting. The piano roll re-fits
  // itself via the roll's ResizeObserver; the rack scrolls as the fallback at
  // the 520x360 minimum. Installed here (not next to the drag) because
  // closePatchMenu is a const above — the menu anchors via
  // getBoundingClientRect and would mis-anchor mid-resize.
  installResize(chrome, {
    minW: 520, minH: 360, yMin: 24,
    gate: () => !maximized,
    onStart: () => closePatchMenu(),
    handle: drag,
  });

  // Arrow (not a hoisted declaration) so the `chrome` null-guard narrowing
  // above applies inside.
  const openPatchMenu = (anchor: HTMLElement, t: Track, sync: () => void): void => {
    closePatchMenu();
    const menu = document.createElement("div");
    menu.className = "up-daw-patchmenu";
    for (const p of audio.PATCHES) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "up-daw-patchmenu-item" + (t.strip.patch === p.key ? " is-on" : "");
      item.innerHTML = `${patchSvg(p.key, 13)}<span>${p.label}</span>`;
      item.addEventListener("click", () => {
        t.strip.patch = p.key;
        sync();
        closePatchMenu();
        setStatus(`${t.name}: instrument set to ${p.label}`);
        // Preview the new voice at a pitch the track actually uses.
        audio.auditionNote(Math.round(avgPitch(t.notes)), t.channel);
      });
      menu.appendChild(item);
    }
    // Mount inside .up-daw-body so the --daw-* custom properties cascade; the
    // positioned ancestor is still the chrome, so chrome-relative coordinates
    // are unchanged.
    (chrome.querySelector(".up-daw-body") ?? chrome).appendChild(menu);
    const cr = chrome.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    menu.style.left = `${Math.round(ar.right - cr.left + 6)}px`;
    let top = Math.round(ar.top - cr.top - 4);
    const mh = menu.offsetHeight;
    if (top + mh > cr.height - 8) top = Math.max(8, Math.round(cr.height - mh - 8));
    menu.style.top = `${top}px`;
    patchMenu = menu;
    patchMenuAnchor = anchor;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  };

  function buildTrackStrip(t: Track): HTMLElement {
    const row = document.createElement("div");
    row.className = "up-daw-track";
    row.style.setProperty("--tc", t.color);

    const chip = document.createElement("span");
    chip.className = "up-daw-track-chip";
    const name = document.createElement("span");
    name.className = "up-daw-track-name";
    name.textContent = t.name;
    name.title = `Channel ${t.channel + 1} · ${t.notes.length} notes`;

    // Instrument selector (pitched strips only — the kit is the kit).
    let patchEl: HTMLElement;
    if (t.channel === 9) {
      patchEl = document.createElement("span");
      patchEl.className = "up-daw-patch-blank";
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "up-daw-patch";
      const sync = (): void => {
        const meta = audio.PATCHES.find((x) => x.key === t.strip.patch) ?? audio.PATCHES[0];
        btn.innerHTML = patchSvg(meta.key, 12);
        const title = `Instrument: ${meta.label}${meta.key === "auto" ? " (follows the Synth section)" : ""}`;
        btn.title = title;
        btn.setAttribute("aria-label", title);
        btn.classList.toggle("is-custom", meta.key !== "auto");
      };
      sync();
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (patchMenu && patchMenuAnchor === btn) {
          closePatchMenu(); // second click on the same button toggles shut
          return;
        }
        openPatchMenu(btn, t, sync);
      });
      patchEl = btn;
    }

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "up-daw-ms";
    mute.textContent = "M";
    mute.title = `Mute ${t.name}`;
    mute.setAttribute("aria-pressed", "false");
    mute.addEventListener("click", () => {
      t.strip.muted = !t.strip.muted;
      mute.classList.toggle("is-mute", t.strip.muted);
      mute.setAttribute("aria-pressed", String(t.strip.muted));
      dirty = true;
    });

    const solo = document.createElement("button");
    solo.type = "button";
    solo.className = "up-daw-ms";
    solo.textContent = "S";
    solo.title = `Solo ${t.name}`;
    solo.setAttribute("aria-pressed", "false");
    solo.addEventListener("click", () => {
      t.strip.solo = !t.strip.solo;
      solo.classList.toggle("is-solo", t.strip.solo);
      solo.setAttribute("aria-pressed", String(t.strip.solo));
      dirty = true;
    });

    const vol = makeKnob({
      label: "", min: 0, max: 1.5, value: t.strip.gain, preset: 1, small: true,
      fmt: fmtPct,
      onInput: (v) => { t.strip.gain = v; },
    });

    row.append(chip, name, patchEl, mute, solo, vol);
    return row;
  }

  // ---- transport -------------------------------------------------------------

  const playGlyph = playBtn?.querySelector<HTMLElement>("[data-daw-play-glyph]");
  const playGlyphOn = playBtn?.querySelector<HTMLElement>("[data-daw-play-glyph-playing]");

  function syncTransport(): void {
    const playing = audio.isPlaying();
    playGlyph?.toggleAttribute("hidden", playing);
    playGlyphOn?.toggleAttribute("hidden", !playing);
    playBtn?.classList.toggle("is-on", playing);
    if (trkLcd) {
      trkLcd.textContent = audio.trackCount()
        ? `${audio.trackIndex() + 1}/${audio.trackCount()}`
        : "—";
    }
    if (posLcd) posLcd.textContent = fmtPos(audio.positionBeats());
    if (bpmLcd && !bpmDragging) {
      bpmLcd.textContent = String(Math.round(audio.bpm()));
      bpmLcd.setAttribute("aria-valuenow", String(Math.round(audio.bpm())));
    }
    dirty = true;
  }

  playBtn?.addEventListener("click", () => { void audio.toggle(); });
  stopBtn?.addEventListener("click", () => { audio.stop(); });
  prevBtn?.addEventListener("click", () => { void audio.selectTrack(audio.trackIndex() - 1); });
  nextBtn?.addEventListener("click", () => { void audio.selectTrack(audio.trackIndex() + 1); });

  // BPM LCD: an LMMS-style drag spinbox. Vertical drag changes tempo, wheel
  // steps it, double-click restores the file's own tempo.
  let bpmDragging = false;
  if (bpmLcd) {
    bpmLcd.setAttribute("aria-valuemin", "40");
    bpmLcd.setAttribute("aria-valuemax", "240");
    bpmLcd.addEventListener("mousedown", (e) => {
      e.preventDefault();
      bpmDragging = true;
      let lastY = e.clientY;
      let acc = 0;
      document.body.classList.add("up-daw-turning");
      const move = (ev: MouseEvent): void => {
        acc += (lastY - ev.clientY) / 3; // 3px per BPM
        lastY = ev.clientY;
        const step = Math.trunc(acc);
        if (step !== 0) {
          acc -= step;
          audio.setBpm(audio.bpm() + step);
          bpmLcd.textContent = String(Math.round(audio.bpm()));
        }
      };
      const up = (): void => {
        bpmDragging = false;
        document.body.classList.remove("up-daw-turning");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        syncTransport();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    bpmLcd.addEventListener("dblclick", () => audio.setBpm(audio.songBpm()));
    bpmLcd.addEventListener("wheel", (e) => {
      e.preventDefault();
      audio.setBpm(audio.bpm() + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    bpmLcd.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); audio.setBpm(audio.bpm() + 1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); audio.setBpm(audio.bpm() - 1); }
    });
  }

  followBtn?.addEventListener("click", () => {
    follow = !follow;
    followBtn.classList.toggle("is-on", follow);
    followBtn.setAttribute("aria-pressed", String(follow));
  });

  // Move the viewport without tripping the "user scrolled, drop follow"
  // heuristic. Only arms the flag when the assignment will actually scroll
  // (a no-op set fires no event, which would leave the flag stuck).
  function setScrollLeft(px: number): void {
    const target = Math.max(0, Math.round(px));
    if (target === scroller!.scrollLeft) return;
    programmaticScroll = true;
    scroller!.scrollLeft = target;
  }

  function setZoom(next: number): void {
    const idx = Math.min(Math.max(next, 0), ZOOMS.length - 1);
    if (idx === zoomIdx || !song) return;
    // Keep the beat at the viewport's center stable across the zoom.
    const vw = roll!.clientWidth;
    const center = (scroller!.scrollLeft + (vw - KEYS_W) / 2) / pxb();
    zoomIdx = idx;
    sizeContent();
    setScrollLeft(center * pxb() - (vw - KEYS_W) / 2);
    dirty = true;
  }
  zoomOutBtn?.addEventListener("click", () => setZoom(zoomIdx - 1));
  zoomInBtn?.addEventListener("click", () => setZoom(zoomIdx + 1));

  audio.onChange(() => {
    syncTransport();
    // Track switches arrive as plain emits (the panel's next button switches
    // too); loadSurface is a cheap no-op until the index actually changes.
    void loadSurface();
  });

  // ---- canvas plumbing ---------------------------------------------------------

  function sizeContent(): void {
    spacer!.style.width = `${contentW()}px`;
    spacer!.style.height = `${contentH()}px`;
  }

  function sizeCanvas(): void {
    const w = roll!.clientWidth;
    const h = roll!.clientHeight;
    if (!w || !h) return;
    dpr = window.devicePixelRatio || 1;
    if (canvas!.width !== Math.round(w * dpr) || canvas!.height !== Math.round(h * dpr)) {
      canvas!.width = Math.round(w * dpr);
      canvas!.height = Math.round(h * dpr);
    }
    dirty = true;
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => sizeCanvas()).observe(roll);
  }

  scroller.addEventListener("scroll", () => {
    if (programmaticScroll) {
      programmaticScroll = false;
    } else if (audio.isPlaying() && follow) {
      // A hand-scroll while following means "let me look around": drop follow
      // until the user re-arms it from the toolbar.
      follow = false;
      followBtn?.classList.remove("is-on");
      followBtn?.setAttribute("aria-pressed", "false");
    }
    dirty = true;
  });

  // ---- piano-roll rendering ------------------------------------------------------

  function yOfPitch(pitch: number, scrollY: number): number {
    return RULER_H + (pitchHi - pitch) * ROW_H - scrollY;
  }

  function drumRowIndex(pitch: number): number {
    if (pitch === 35 || pitch === 36) return 2; // kick
    if (pitch === 38 || pitch === 40) return 1; // snare
    return 0; // everything else is rendered as the hat
  }

  function draw(): void {
    const g = canvas!.getContext("2d");
    if (!g || !song) return;
    const vw = roll!.clientWidth;
    const vh = roll!.clientHeight;
    if (!vw || !vh) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sx = scroller!.scrollLeft;
    const sy = scroller!.scrollTop;
    const zb = pxb();
    const beat0 = Math.max(0, (sx - 4) / zb);
    const beat1 = (sx + vw) / zb;
    const playing = audio.isPlaying();
    const pos = audio.positionBeats();

    // backdrop
    g.fillStyle = "#1B1E23";
    g.fillRect(0, 0, vw, vh);

    // pitch rows — black-key rows darker, like every piano roll since forever
    for (let p = pitchHi; p >= pitchLo; p--) {
      const y = yOfPitch(p, sy);
      if (y + ROW_H < RULER_H || y > vh) continue;
      g.fillStyle = BLACK.has(p % 12) ? "#181B1F" : "#20242A";
      g.fillRect(0, y, vw, ROW_H);
      if (p % 12 === 0) { // octave line under each C
        g.fillStyle = "rgba(255,255,255,.07)";
        g.fillRect(0, y + ROW_H - 1, vw, 1);
      }
    }

    // drum lane backdrop
    const dt = drumTop() - sy;
    if (hasDrums && dt < vh) {
      g.fillStyle = "#14161A";
      g.fillRect(0, dt - DRUM_GAP, vw, DRUM_GAP);
      for (let i = 0; i < DRUM_ROWS.length; i++) {
        g.fillStyle = i % 2 ? "#1E2126" : "#22262C";
        g.fillRect(0, dt + i * ROW_H, vw, ROW_H);
      }
    }

    // beat / bar grid
    const firstBeat = Math.floor(beat0);
    for (let b = firstBeat; b <= beat1; b++) {
      const x = KEYS_W + b * zb - sx;
      if (x < KEYS_W - 1) continue;
      const isBar = b % 4 === 0;
      g.fillStyle = isBar ? "rgba(255,255,255,.13)" : "rgba(255,255,255,.05)";
      g.fillRect(x, RULER_H, 1, vh - RULER_H);
      if (zb >= 38) { // sixteenth ticks only when zoomed in
        g.fillStyle = "rgba(255,255,255,.025)";
        for (let s16 = 1; s16 < 4; s16++) g.fillRect(x + (s16 * zb) / 4, RULER_H, 1, vh - RULER_H);
      }
    }

    // notes
    const anySolo = tracks.some((t) => t.strip.solo);
    for (const t of tracks) {
      const silent = t.strip.muted || (anySolo && !t.strip.solo);
      const isDrum = t.channel === 9;
      g.globalAlpha = silent ? 0.22 : 1;
      for (const n of t.notes) {
        if (n.start + n.dur < beat0 || n.start > beat1) continue;
        const x = KEYS_W + n.start * zb - sx;
        let y: number;
        let w: number;
        if (isDrum) {
          if (!hasDrums) continue;
          y = dt + drumRowIndex(n.pitch) * ROW_H + 1;
          w = Math.max(4, Math.min(n.dur * zb - 1, 8));
        } else {
          if (n.pitch < pitchLo || n.pitch > pitchHi) continue;
          y = yOfPitch(n.pitch, sy) + 1;
          w = Math.max(3, n.dur * zb - 1);
        }
        if (y + ROW_H < RULER_H || y > vh) continue;
        if (n.dead) {
          // Ghost: a right-click-muted note stays findable for restoring.
          g.globalAlpha = 0.13;
          g.fillStyle = t.color;
          g.fillRect(x, y, w, ROW_H - 2);
          g.globalAlpha = silent ? 0.22 : 1;
          continue;
        }
        const sounding = playing && !silent && pos >= n.start && pos < n.start + Math.max(n.dur, 0.25);
        g.fillStyle = sounding ? "#FFFFFF" : t.color;
        g.fillRect(x, y, w, ROW_H - 2);
        if (w > 5) {
          g.fillStyle = "rgba(0,0,0,.35)";
          g.fillRect(x + w - 1, y, 1, ROW_H - 2);
          g.fillRect(x, y + ROW_H - 3, w, 1);
        }
      }
      g.globalAlpha = 1;
    }

    // playhead — drawn while stopped too, marking the pause/seek resume point
    {
      const x = KEYS_W + pos * zb - sx;
      if (x >= KEYS_W && x <= vw) {
        g.fillStyle = ACCENT;
        g.globalAlpha = playing ? 1 : 0.6;
        g.fillRect(x, 0, 1.5, vh);
        g.globalAlpha = 1;
      }
    }

    // ruler (sticky top)
    g.fillStyle = "#14161A";
    g.fillRect(0, 0, vw, RULER_H);
    g.fillStyle = "rgba(255,255,255,.12)";
    g.fillRect(0, RULER_H - 1, vw, 1);
    g.font = '10px "Ubuntu Mono", monospace';
    g.textBaseline = "middle";
    const barPx = zb * 4;
    const barStep = Math.max(1, Math.ceil(34 / barPx));
    for (let bar = Math.floor(beat0 / 4); bar * 4 <= beat1; bar++) {
      if (bar % barStep !== 0) continue;
      const x = KEYS_W + bar * barPx - sx;
      if (x < KEYS_W - 20) continue;
      g.fillStyle = "rgba(255,255,255,.18)";
      g.fillRect(x, 4, 1, RULER_H - 8);
      g.fillStyle = "#8E939B";
      g.fillText(String(bar + 1), x + 4, RULER_H / 2 + 0.5);
    }
    { // playhead marker rides over the ruler
      const x = KEYS_W + pos * zb - sx;
      if (x >= KEYS_W && x <= vw) {
        g.fillStyle = ACCENT;
        g.globalAlpha = playing ? 1 : 0.6;
        g.beginPath();
        g.moveTo(x - 4, 0);
        g.lineTo(x + 5.5, 0);
        g.lineTo(x + 0.75, 7);
        g.closePath();
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // key column (sticky left, over everything)
    g.fillStyle = "#23262C";
    g.fillRect(0, RULER_H, KEYS_W, vh - RULER_H);
    for (let p = pitchHi; p >= pitchLo; p--) {
      const y = yOfPitch(p, sy);
      if (y + ROW_H < RULER_H || y > vh) continue;
      const black = BLACK.has(p % 12);
      g.fillStyle = black ? "#2A2D33" : "#E8E6E2";
      g.fillRect(0, y + 0.5, black ? KEYS_W - 16 : KEYS_W - 8, ROW_H - 1);
      if (p % 12 === 0) {
        g.fillStyle = "#6B6F76";
        g.font = '9px "Ubuntu Mono", monospace';
        g.fillText(noteName(p), KEYS_W - 16, y + ROW_H / 2 + 0.5);
      }
    }
    if (hasDrums && dt < vh) {
      g.fillStyle = "#23262C";
      g.fillRect(0, dt - DRUM_GAP, KEYS_W, DRUM_GAP + DRUM_ROWS.length * ROW_H + 8);
      g.font = '9px "Ubuntu Mono", monospace';
      g.fillStyle = "#8E939B";
      for (let i = 0; i < DRUM_ROWS.length; i++) {
        g.fillText(DRUM_ROWS[i].label, 6, dt + i * ROW_H + ROW_H / 2 + 0.5);
      }
    }
    g.fillStyle = "rgba(255,255,255,.10)";
    g.fillRect(KEYS_W - 1, RULER_H, 1, vh - RULER_H);

    // corner cell
    g.fillStyle = "#14161A";
    g.fillRect(0, 0, KEYS_W, RULER_H);
    g.fillStyle = "rgba(255,255,255,.12)";
    g.fillRect(0, RULER_H - 1, KEYS_W, 1);
  }

  // ---- piano-roll interaction ----------------------------------------------------

  interface Hit { note: MidiNote; track: Track; }

  // Topmost note (last in draw order) under a content-space point, in either
  // the pitched grid or the drum lane. A few px of minimum width keeps sliver
  // notes grabbable at low zoom.
  function noteAt(cx: number, cy: number): Hit | null {
    if (!song) return null;
    const beat = (cx - KEYS_W) / pxb();
    const minDur = 4 / pxb();
    let hit: Hit | null = null;
    const py = cy - RULER_H;
    if (py >= 0 && py < rows() * ROW_H) {
      const pitch = pitchHi - Math.floor(py / ROW_H);
      for (const t of tracks) {
        if (t.channel === 9) continue;
        for (const n of t.notes) {
          if (n.pitch !== pitch) continue;
          if (beat >= n.start && beat <= n.start + Math.max(n.dur, minDur)) hit = { note: n, track: t };
        }
      }
    } else if (hasDrums) {
      const dy = cy - drumTop();
      if (dy >= 0 && dy < DRUM_ROWS.length * ROW_H) {
        const row = Math.floor(dy / ROW_H);
        for (const t of tracks) {
          if (t.channel !== 9) continue;
          for (const n of t.notes) {
            if (drumRowIndex(n.pitch) !== row) continue;
            if (beat >= n.start && beat <= n.start + Math.max(n.dur, minDur)) hit = { note: n, track: t };
          }
        }
      }
    }
    return hit;
  }

  function drumLabel(pitch: number): string {
    const i = drumRowIndex(pitch);
    return i === 2 ? "Kick" : i === 1 ? "Snare" : "Hat";
  }

  // Both coordinate spaces: content (cx/cy, scroll-offset — for notes and the
  // grid, which scroll) and viewport (vx/vy — for the ruler and key column,
  // which the canvas paints screen-sticky). Testing the sticky chrome against
  // content coords silently breaks once the roll is scrolled.
  function pointInfo(e: MouseEvent): { cx: number; cy: number; vx: number; vy: number } {
    const r = scroller!.getBoundingClientRect();
    const vx = e.clientX - r.left;
    const vy = e.clientY - r.top;
    return { cx: vx + scroller!.scrollLeft, cy: vy + scroller!.scrollTop, vx, vy };
  }

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  scroller.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !song) return;
    const { cx, cy, vx, vy } = pointInfo(e);

    // Ruler: click (or scrub) to move the transport. Works paused too — the
    // playhead becomes the resume point, so you can cue up a section.
    if (vy < RULER_H && vx >= KEYS_W) {
      e.preventDefault();
      const beatAt = (clientX: number): number => {
        const r = scroller!.getBoundingClientRect();
        return (clientX - r.left + scroller!.scrollLeft - KEYS_W) / pxb();
      };
      let last = -1;
      const scrub = (clientX: number): void => {
        // Snap to the sixteenth grid the synth schedules on; skip no-op seeks
        // so a scrub doesn't re-cut the voices every mousemove.
        const b = Math.max(0, Math.round(beatAt(clientX) * 4) / 4);
        if (b === last) return;
        last = b;
        audio.seek(b);
        const bar = Math.floor(b / 4) + 1;
        setStatus(`Bar ${bar} — ${audio.isPlaying() ? "playing from here" : "play starts here"}`);
      };
      scrub(e.clientX);
      const move = (ev: MouseEvent): void => scrub(ev.clientX);
      const up = (): void => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        setStatus(defaultStatus);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    if (vx < KEYS_W || vy < RULER_H) return; // sticky key column / corner

    const hit = noteAt(cx, cy);
    if (hit && hit.note.channel === 9) {
      // Drum hits audition but don't transpose (the kit rows are fixed
      // mappings, not a pitch axis); right-click still mutes them.
      audio.auditionNote(hit.note.pitch, 9);
      setStatus(`Drums · ${drumLabel(hit.note.pitch)} — right-click to ${hit.note.dead ? "restore" : "mute"}`);
      return;
    }
    if (hit) {
      // Drag to transpose: the note object is the engine's, so the edit is
      // audible on the scheduler's next pass — sculpt the melody while it loops.
      e.preventDefault();
      const startPitch = hit.note.pitch;
      const startY = e.clientY;
      let lastAudition = -1;
      document.body.classList.add("up-daw-transposing");
      const move = (ev: MouseEvent): void => {
        const delta = Math.round((startY - ev.clientY) / ROW_H);
        const next = Math.min(Math.max(startPitch + delta, pitchLo), pitchHi);
        if (next !== hit.note.pitch) {
          hit.note.pitch = next;
          dirty = true;
          if (next !== lastAudition) {
            lastAudition = next;
            audio.auditionNote(next, hit.note.channel);
          }
          const off = next - startPitch;
          setStatus(`${hit.track.name}: ${noteName(startPitch)} → ${noteName(next)} (${off > 0 ? "+" : ""}${off} st)`);
        }
      };
      const up = (): void => {
        document.body.classList.remove("up-daw-transposing");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        setStatus(defaultStatus);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    // Empty grid: audition the pitch (or drum) under the cursor.
    const py = cy - RULER_H;
    if (py >= 0 && py < rows() * ROW_H) {
      const pitch = pitchHi - Math.floor(py / ROW_H);
      audio.auditionNote(pitch, 0);
      const hz = 440 * Math.pow(2, (pitch - 69) / 12);
      setStatus(`${noteName(pitch)} · ${hz.toFixed(1)} Hz`);
    } else if (hasDrums) {
      const di = Math.floor((cy - drumTop()) / ROW_H);
      if (di >= 0 && di < DRUM_ROWS.length) {
        audio.auditionNote(DRUM_ROWS[di].pitch, 9);
        setStatus(DRUM_ROWS[di].label === "kck" ? "Kick" : DRUM_ROWS[di].label === "snr" ? "Snare" : "Hat");
      }
    }
  });

  scroller.addEventListener("mousemove", (e) => {
    if (!song || e.buttons) return;
    const { cx, cy, vx, vy } = pointInfo(e);
    if (vy < RULER_H && vx >= KEYS_W) {
      scroller!.style.cursor = "pointer";
      setStatus("Timeline — click or drag to move the playhead");
      return;
    }
    if (vx < KEYS_W || vy < RULER_H) {
      scroller!.style.cursor = "";
      setStatus(defaultStatus);
      return;
    }
    const hit = noteAt(cx, cy);
    const isDrumHit = hit !== null && hit.note.channel === 9;
    scroller!.style.cursor = hit && !isDrumHit ? "ns-resize" : "";
    if (hit) {
      const bar = Math.floor(hit.note.start / 4) + 1;
      const label = isDrumHit ? `Drums · ${drumLabel(hit.note.pitch)}` : `${hit.track.name} · ${noteName(hit.note.pitch)}`;
      const verbs = `${isDrumHit ? "" : "drag to transpose, "}right-click to ${hit.note.dead ? "restore" : "mute"}`;
      setStatus(`${label} · bar ${bar}${hit.note.dead ? " (muted)" : ""} — ${verbs}`);
    } else {
      setStatus(defaultStatus);
    }
  });
  scroller.addEventListener("mouseleave", () => setStatus(defaultStatus));

  // Right-click toggles a note's mute (session-only `dead` flag the scheduler
  // skips); the note stays visible as a ghost so it can be restored.
  scroller.addEventListener("contextmenu", (e) => {
    if (!song) return;
    const { cx, cy, vx, vy } = pointInfo(e);
    if (vx < KEYS_W || vy < RULER_H) return; // sticky chrome keeps the native menu
    e.preventDefault();
    const hit = noteAt(cx, cy);
    if (!hit) return;
    hit.note.dead = !hit.note.dead;
    dirty = true;
    const label = hit.note.channel === 9
      ? `Drums · ${drumLabel(hit.note.pitch)}`
      : `${hit.track.name} · ${noteName(hit.note.pitch)}`;
    setStatus(hit.note.dead ? `${label} muted — right-click to restore` : `${label} restored`);
  });

  // ---- frame loop -----------------------------------------------------------------

  function fmtPos(beats: number): string {
    const bar = Math.floor(beats / 4) + 1;
    const beat = Math.floor(beats % 4) + 1;
    return `${String(bar).padStart(3, "0")}.${beat}`;
  }

  // The loop only runs while the window is visible (startLoop/stopLoop from the
  // state machine), and only repaints on playback or a dirty flag.
  function frame(): void {
    raf = requestAnimationFrame(frame);
    if (!song) return;
    if (audio.isPlaying()) {
      const pos = audio.positionBeats();
      if (posLcd) posLcd.textContent = fmtPos(pos);
      if (follow) {
        const vw = roll!.clientWidth;
        const x = KEYS_W + pos * pxb() - scroller!.scrollLeft;
        if (x > vw * 0.78 || x < KEYS_W) {
          // Jump-scroll so the playhead re-enters at the first third — one
          // discrete reposition per page, not a per-frame creep.
          setScrollLeft(pos * pxb() - (vw - KEYS_W) * 0.3);
        }
      }
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      draw();
    }
  }

  function startLoop(): void {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stopLoop(): void {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
}
