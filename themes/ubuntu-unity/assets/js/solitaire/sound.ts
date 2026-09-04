// Sound effects for the solitaire table, synthesized on the fly with Web
// Audio (no samples to ship). The AudioContext is created lazily by
// `unlock()` inside a user gesture so browser autoplay policy is satisfied,
// and every effect degrades to silence when the context is missing or
// suspended. Browsers disagree on which gesture counts: Chrome accepts a
// mouse pointerdown but not a touch one, and WebKit wants mousedown,
// touchend, click, or keydown and may leave a resume() from anything else
// pending forever. So the table calls `unlock()` from every one of those,
// `unlock()` also starts a silent buffer inside the gesture (the classic
// iOS trick), and `play()` keeps retrying resume() until the context
// reports running. Session-only: mute resets on reload.

export type SfxName =
  | "pickup" | "place" | "flip" | "invalid" | "foundation" | "deal"
  | "draw" | "undo" | "button" | "hint" | "win" | "bounce" | "shuffle";

const NOISE_SECONDS = 1.5;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastBounce = 0;
  muted = false;

  /** Create the context, or nudge a suspended one awake. Call from any
   *  gesture handler; repeated calls are cheap. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.6;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      master.connect(comp).connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    if (this.ctx.state === "running") return;
    this.wake(this.ctx);
  }

  /** resume() plus a one-frame silent source started inside the gesture,
   *  which is what actually opens the audio session on iOS. */
  private wake(ctx: AudioContext): void {
    void ctx.resume().catch(() => undefined);
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // Older WebKit throws on start() outside a gesture; nothing to do.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    }
  }

  play(name: SfxName, arg = 0): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out || this.muted) return;
    if (ctx.state !== "running") {
      // Still locked: the page has been interacted with by now, so a fresh
      // resume() usually succeeds and the next effect plays.
      this.wake(ctx);
      return;
    }
    const t = ctx.currentTime;
    // A touch of pitch drift keeps repeated effects from sounding stamped.
    const drift = 1 + (Math.random() - 0.5) * 0.08;
    switch (name) {
      case "pickup":
        this.burst(t, 0.05, "bandpass", 900 * drift, 2600, 0.35, 3);
        break;
      case "place":
        this.tone(t, 170 * drift, 55, 0.07, "sine", 0.5);
        this.burst(t, 0.04, "lowpass", 900, 300, 0.4, 1);
        break;
      case "flip":
        this.burst(t, 0.09, "bandpass", 500 * drift, 3800, 0.22, 2);
        break;
      case "shuffle":
        for (let i = 0; i < 6; i++) this.burst(t + i * 0.035, 0.03, "bandpass", 1400 + i * 200, 2200, 0.16, 3);
        break;
      case "invalid":
        this.tone(t, 160, 150, 0.09, "square", 0.12);
        this.tone(t + 0.1, 115, 105, 0.12, "square", 0.12);
        break;
      case "draw":
        this.burst(t, 0.06, "bandpass", 700 * drift, 2400, 0.25, 3);
        this.tone(t + 0.03, 240 * drift, 120, 0.05, "sine", 0.25);
        break;
      case "foundation": {
        // A pentatonic step that climbs with every card sent up, so filling
        // a foundation plays a rising scale.
        const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];
        const semis = scale[Math.max(0, Math.min(scale.length - 1, arg))];
        const f = 523.25 * Math.pow(2, semis / 12);
        this.chime(t, f, 0.32);
        this.chime(t + 0.02, f * 2, 0.16, 0.5);
        this.burst(t, 0.04, "highpass", 3000, 1, 0.12, 1);
        break;
      }
      case "deal":
        this.burst(t, 0.03, "bandpass", 1600 + arg * 25, 2400, 0.18, 3);
        break;
      case "undo":
        this.sweep(t, 900, 260, 0.14, 0.14);
        break;
      case "button":
        this.tone(t, 420 * drift, 300, 0.04, "square", 0.08);
        this.burst(t, 0.03, "highpass", 2500, 1, 0.14, 1);
        break;
      case "hint":
        this.chime(t, 880, 0.12, 0.35);
        this.chime(t + 0.11, 1174.7, 0.18, 0.35);
        break;
      case "win": {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 2093];
        notes.forEach((f, i) => this.chime(t + i * 0.09, f, 0.5, 0.45));
        notes.slice(0, 4).forEach((f) => this.chime(t + 0.75, f, 1.6, 0.25));
        break;
      }
      case "bounce": {
        // Throttled: the cascade fires this on every bounce.
        const now = performance.now();
        if (now - this.lastBounce < 70) return;
        this.lastBounce = now;
        this.tone(t, 300 + Math.random() * 500, 120, 0.05, "triangle", 0.18);
        break;
      }
    }
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    return this.noise;
  }

  /** A filtered noise burst with a fast decay; `sweepTo` glides the filter. */
  private burst(t: number, dur: number, type: BiquadFilterType, freq: number, sweepTo: number, peak: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    src.loopStart = Math.random() * (NOISE_SECONDS - 0.2);
    src.loopEnd = src.loopStart + 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t, src.loopStart);
    src.stop(t + dur + 0.02);
  }

  /** A pitched blip that slides from `from` to `to`. */
  private tone(t: number, from: number, to: number, dur: number, type: OscillatorType, peak: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private sweep(t: number, from: number, to: number, dur: number, peak: number): void {
    this.tone(t, from, to, dur, "sine", peak);
    this.burst(t, dur, "bandpass", from, to, peak * 0.8, 4);
  }

  /** A bell-ish note: sine plus a quieter second partial, long decay. */
  private chime(t: number, freq: number, dur: number, peak = 0.4): void {
    const ctx = this.ctx!;
    const partials: [number, number][] = [[1, 1], [2.01, 0.35], [3, 0.12]];
    for (const [ratio, amp] of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak * amp, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.master!);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }
}
