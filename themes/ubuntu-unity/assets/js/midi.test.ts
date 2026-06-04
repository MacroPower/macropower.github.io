// Parser + tempo-warp suite for midi.ts, driven by tiny synthetic SMF files
// built byte-by-byte (no fixtures on disk). Division 96 throughout, so one
// beat = 96 ticks.

import { describe, expect, it } from "vitest";
import { parseMidi } from "./midi";

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

interface Ev { delta: number; bytes: number[]; }

const tempo = (bpm: number): number[] => {
  const us = Math.round(60000000 / bpm);
  return [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff];
};
const on = (pitch: number, ch = 0, vel = 100): number[] => [0x90 | ch, pitch, vel];
const off = (pitch: number, ch = 0): number[] => [0x80 | ch, pitch, 0];

function smf(events: Ev[], division = 96): ArrayBuffer {
  const trk: number[] = [];
  for (const e of events) trk.push(...vlq(e.delta), ...e.bytes);
  trk.push(0x00, 0xff, 0x2f, 0x00); // end of track
  const bytes = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, // MThd, format 0, 1 track
    (division >> 8) & 0xff, division & 0xff,
    0x4d, 0x54, 0x72, 0x6b,
    (trk.length >>> 24) & 0xff, (trk.length >> 16) & 0xff, (trk.length >> 8) & 0xff, trk.length & 0xff,
    ...trk,
  ];
  return new Uint8Array(bytes).buffer;
}

describe("parseMidi", () => {
  it("parses notes and tempo from a single-tempo file", () => {
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(100) },
      { delta: 0, bytes: on(60) },
      { delta: 96, bytes: off(60) }, // 1 beat long
      { delta: 0, bytes: on(62) },
      { delta: 48, bytes: off(62) }, // half a beat long
    ]));
    expect(song.bpm).toBeCloseTo(100, 6);
    expect(song.durationBeats).toBeCloseTo(1.5, 9);
    expect(song.notes).toHaveLength(2);
    expect(song.notes[0]).toMatchObject({ pitch: 60, channel: 0 });
    expect(song.notes[0].start).toBeCloseTo(0, 9);
    expect(song.notes[0].dur).toBeCloseTo(1, 9);
    expect(song.notes[1].start).toBeCloseTo(1, 9);
    expect(song.notes[1].dur).toBeCloseTo(0.5, 9);
  });

  it("records the MIDI channel", () => {
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(120) },
      { delta: 0, bytes: on(36, 9) },
      { delta: 24, bytes: off(36, 9) },
    ]));
    expect(song.notes[0].channel).toBe(9);
  });

  it("normalizes note-on velocity to 0..1", () => {
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(120) },
      { delta: 0, bytes: on(60, 0, 127) },
      { delta: 48, bytes: off(60) },
      { delta: 0, bytes: on(62, 0, 64) },
      { delta: 48, bytes: off(62) },
    ]));
    expect(song.notes[0].vel).toBeCloseTo(1, 9);
    expect(song.notes[1].vel).toBeCloseTo(64 / 127, 9);
  });

  it("trims a silent lead-in so playback starts on the first note", () => {
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(120) },
      { delta: 192, bytes: on(60) }, // first onset at raw beat 2
      { delta: 96, bytes: off(60) },
    ]));
    expect(song.notes[0].start).toBeCloseTo(0, 9);
    expect(song.durationBeats).toBeCloseTo(1, 9);
  });

  it("picks the dominant tempo, not the first or last", () => {
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(100) },
      { delta: 0, bytes: on(60) },
      { delta: 768, bytes: off(60) }, // 8 beats at 100
      { delta: 0, bytes: tempo(200) },
      { delta: 0, bytes: on(62) },
      { delta: 192, bytes: off(62) }, // 2 raw beats at 200
    ]));
    expect(song.bpm).toBeCloseTo(100, 6);
  });

  it("warps multi-tempo sections to their true pacing in dominant-tempo beats", () => {
    // 100 BPM for 8 beats, then 200 BPM. At the dominant 100 BPM, the second
    // section's notes play twice as fast: 2 raw beats become 1 nominal beat.
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(100) },
      { delta: 0, bytes: on(60) },
      { delta: 768, bytes: off(60) },
      { delta: 0, bytes: tempo(200) },
      { delta: 0, bytes: on(62) },
      { delta: 192, bytes: off(62) },
    ]));
    const second = song.notes.find((n) => n.pitch === 62)!;
    expect(second.start).toBeCloseTo(8, 9);
    expect(second.dur).toBeCloseTo(1, 9);
    expect(song.durationBeats).toBeCloseTo(9, 9);
  });

  it("assumes the SMF default 120 BPM before the first set_tempo", () => {
    // One beat of (implicit) 120, then 60 BPM. Dominant is 60 (it spans the
    // rest of the song), so the default-tempo beat warps to half a beat.
    const song = parseMidi(smf([
      { delta: 0, bytes: on(60) },
      { delta: 96, bytes: off(60) }, // raw beat 0..1 under default 120
      { delta: 0, bytes: tempo(60) },
      { delta: 0, bytes: on(62) },
      { delta: 96, bytes: off(62) }, // raw beat 1..2 under 60
    ]));
    expect(song.bpm).toBeCloseTo(60, 6);
    expect(song.notes[0].start).toBeCloseTo(0, 9);
    expect(song.notes[0].dur).toBeCloseTo(0.5, 9);
    expect(song.notes[1].start).toBeCloseTo(0.5, 9);
    expect(song.notes[1].dur).toBeCloseTo(1, 9);
  });

  it("keeps single-tempo timing exact (no warp applied)", () => {
    // A lone tempo event must leave raw beat positions untouched, including
    // off-grid ones (the adaptive-quantize path depends on them surviving).
    const song = parseMidi(smf([
      { delta: 0, bytes: tempo(130) },
      { delta: 0, bytes: on(60) },
      { delta: 32, bytes: off(60) }, // a third of a beat: triplet material
      { delta: 0, bytes: on(62) },
      { delta: 32, bytes: off(62) },
    ]));
    expect(song.notes[0].dur).toBeCloseTo(1 / 3, 9);
    expect(song.notes[1].start).toBeCloseTo(1 / 3, 9);
  });
});
