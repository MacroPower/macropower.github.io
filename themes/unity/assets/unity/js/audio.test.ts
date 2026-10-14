// Checks for the Web Audio graphs in audio.ts and solitaire/sound.ts. Node
// has no Web Audio, so each suite runs once without AudioContext and once
// with a fake one stubbed on the global. The fake records each node it
// creates, each connection, and each scheduled value. A test finds a graph
// node by its place in the chain and reads what the module set on it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Sfx } from "./solitaire/sound";

class FakeParam {
  value = 0;
  readonly targets: number[] = [];
  setTargetAtTime(v: number): this {
    this.targets.push(v);
    return this;
  }
  setValueAtTime(v: number): this {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(): this { return this; }
  exponentialRampToValueAtTime(): this { return this; }
}

class FakeNode {
  readonly kind: string;
  readonly outputs: unknown[] = [];
  readonly gain = new FakeParam();
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  readonly delayTime = new FakeParam();
  readonly Q = new FakeParam();
  readonly pan = new FakeParam();
  readonly threshold = new FakeParam();
  readonly ratio = new FakeParam();
  type = "";
  oversample = "";
  curve: Float32Array | null = null;
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  constructor(kind: string) {
    this.kind = kind;
  }
  connect<T>(target: T): T {
    this.outputs.push(target);
    return target;
  }
  start(): void { /* no-op */ }
  stop(): void { /* no-op */ }
  addEventListener(): void { /* no-op */ }
  setPeriodicWave(): void { /* no-op */ }
}

const contexts: FakeContext[] = [];

class FakeContext {
  state = "suspended";
  currentTime = 0;
  readonly sampleRate = 8000;
  readonly destination = new FakeNode("destination");
  readonly nodes: FakeNode[] = [];
  constructor() {
    contexts.push(this);
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  createGain(): FakeNode { return this.node("gain"); }
  createBiquadFilter(): FakeNode { return this.node("biquad"); }
  createWaveShaper(): FakeNode { return this.node("shaper"); }
  createDynamicsCompressor(): FakeNode { return this.node("compressor"); }
  createDelay(): FakeNode { return this.node("delay"); }
  createConvolver(): FakeNode { return this.node("convolver"); }
  createOscillator(): FakeNode { return this.node("osc"); }
  createBufferSource(): FakeNode { return this.node("source"); }
  createStereoPanner(): FakeNode { return this.node("panner"); }
  createPeriodicWave(): object { return {}; }
  createBuffer(channels: number, length: number): { getChannelData(i: number): Float32Array } {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (i) => data[i] ?? new Float32Array(0) };
  }
  private node(kind: string): FakeNode {
    const n = new FakeNode(kind);
    this.nodes.push(n);
    return n;
  }
}

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1);
  return items[0]!;
}

// The node that `from` connects to and that `pick` accepts.
function next(from: FakeNode, pick: (n: FakeNode) => boolean): FakeNode {
  return only(from.outputs.filter((o): o is FakeNode => o instanceof FakeNode && pick(o)));
}

// Lets a resume().then() callback run.
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// One middle C, one beat long, at the default 120 bpm.
const ONE_NOTE = new Uint8Array([
  0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
  0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12,
  0x00, 0x90, 60, 100, 96, 0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00,
]);

beforeEach(() => {
  contexts.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio.ts", () => {
  // A fresh module per test, because the graph lives in module scope.
  async function load(): Promise<typeof import("./audio")> {
    vi.resetModules();
    return import("./audio");
  }

  it("stays silent without Web Audio", async () => {
    const audio = await load();
    audio.configure([{ url: "song.mid", title: "" }]);
    await expect(audio.toggle()).resolves.toBe(false);
    expect(audio.isPlaying()).toBe(false);
    expect(() => {
      audio.auditionNote(60);
      audio.setParam("cutoff", 500);
      audio.setVolume(80);
      audio.setBpm(90);
      audio.seek(1);
    }).not.toThrow();
  });

  it("builds one graph and drives it from the live params", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    const audio = await load();
    audio.auditionNote(60);
    audio.auditionNote(62);
    await settle();
    const ctx = only(contexts);

    const filter = only(ctx.nodes.filter((n) => n.kind === "biquad" && n.type === "lowpass"));
    const master = only(ctx.nodes.filter((n) => n.outputs.includes(filter)));
    const drive = next(filter, (n) => n.kind === "shaper");
    const crush = next(drive, (n) => n.kind === "shaper");
    const delay = only(ctx.nodes.filter((n) => n.kind === "delay"));
    const lfo = only(ctx.nodes.filter((n) => n.kind === "osc" && n.frequency.value === 5.5));
    const vibDepth = next(lfo, (n) => n.kind === "gain");

    audio.setParam("cutoff", 5000);
    expect(filter.frequency.targets).toEqual([5000]);
    audio.setVolume(100);
    expect(master.gain.targets).toEqual([0.5]);
    audio.setParam("drive", 0.5);
    expect(drive.curve).not.toBeNull();
    audio.setParam("crush", 0.5);
    expect(crush.curve).not.toBeNull();
    audio.setParam("echoDiv", 1);
    expect(delay.delayTime.targets).toEqual([0.5]);
    audio.setParam("vib", 12);
    expect(vibDepth.gain.targets).toEqual([12]);
    // Each auditioned oscillator takes the vibrato on its detune.
    const tapped = ctx.nodes.filter((n) => n.kind === "osc" && vibDepth.outputs.includes(n.detune));
    expect(tapped.length).toBeGreaterThan(0);
  });

  it("plays, retimes, and pauses a song through the graph", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(ONE_NOTE)));
    const audio = await load();
    audio.configure([{ url: "song.mid", title: "" }]);

    await expect(audio.toggle()).resolves.toBe(true);
    expect(audio.isPlaying()).toBe(true);
    const ctx = only(contexts);
    const delay = only(ctx.nodes.filter((n) => n.kind === "delay"));
    // Starting syncs the echo to the song's tempo: a dotted eighth at 120 bpm.
    expect(delay.delayTime.targets).toEqual([0.375]);
    ctx.currentTime = 0.35;
    expect(audio.positionBeats()).toBeCloseTo(0.5, 9);

    audio.setBpm(150);
    expect(delay.delayTime.targets.at(-1)).toBeCloseTo(0.3, 9);
    expect(audio.positionBeats()).toBeCloseTo(0.5, 9);

    await expect(audio.toggle()).resolves.toBe(false);
    expect(audio.isPlaying()).toBe(false);
    expect(audio.positionBeats()).toBeCloseTo(0.5, 9);
    expect(contexts).toHaveLength(1);
  });
});

describe("solitaire Sfx", () => {
  it("stays silent without Web Audio", () => {
    const sfx = new Sfx();
    expect(() => {
      sfx.unlock();
      sfx.play("place");
      sfx.setMuted(true);
    }).not.toThrow();
  });

  it("creates one context and routes every effect to its master gain", () => {
    vi.stubGlobal("AudioContext", FakeContext);
    const sfx = new Sfx();
    sfx.unlock();
    sfx.unlock();
    const ctx = only(contexts);
    expect(ctx.state).toBe("running");
    const master = only(ctx.nodes.filter((n) => n.kind === "gain" && n.outputs.some((o) => o instanceof FakeNode && o.kind === "compressor")));
    expect(master.gain.value).toBe(0.6);

    sfx.play("place");
    const feeds = ctx.nodes.filter((n) => n.outputs.includes(master));
    // The place effect is one tone and one noise burst.
    expect(feeds).toHaveLength(2);

    sfx.setMuted(true);
    expect(master.gain.targets).toEqual([0]);
  });
});
