// Minimal Standard MIDI File parser. Reads an ArrayBuffer (format 0 or 1) into a
// flat, time-ordered note list with beat-based timing, plus the tempo. Just
// enough to drive the player in audio.ts — no controllers, no pitch-bend.
// Times are in beats (quarter notes); the player converts to seconds via the
// bpm. Multi-tempo files are honored by warping: every note's raw beat
// position runs through the file's tempo map into real seconds and back into
// dominant-tempo-equivalent beats, so a single-tempo player reproduces the
// original pacing exactly (rubato, count-ins, and section changes included)
// while the rest of the pipeline keeps thinking in plain beats.

export interface MidiNote {
  channel: number; // 0-15 (channel 9 is the GM drum kit)
  pitch: number; // MIDI note number (60 = middle C)
  start: number; // beats from the start of the file
  dur: number; // length in beats
  vel: number; // note-on velocity, normalized 0..1
  dead?: boolean; // muted from the Studio's piano roll (session-only edit)
}

export interface MidiSong {
  bpm: number;
  durationBeats: number;
  notes: MidiNote[]; // sorted by start
}

export function parseMidi(buf: ArrayBuffer): MidiSong {
  const dv = new DataView(buf);
  if (dv.getUint32(0) !== 0x4d546864) throw new Error("not a MIDI file"); // "MThd"
  const division = dv.getUint16(12); // ticks per quarter note (assume PPQ, high bit clear)
  const u8 = (o: number): number => dv.getUint8(o);

  const notes: MidiNote[] = [];
  const tempos: { tick: number; us: number }[] = []; // tempo changes (microseconds per quarter)
  let p = 14;

  while (p + 8 <= buf.byteLength) {
    if (dv.getUint32(p) !== 0x4d54726b) { p += 1; continue; } // seek "MTrk"
    const len = dv.getUint32(p + 4);
    let q = p + 8;
    const end = q + len;
    p = end;

    let tick = 0;
    let status = 0;
    const pending = new Map<number, [tick: number, vel: number][]>(); // (channel<<8|pitch) -> open note-ons

    const readVlq = (): number => {
      let v = 0;
      for (;;) { const b = u8(q++); v = (v << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
      return v;
    };

    while (q < end) {
      tick += readVlq();
      let b = u8(q);
      if (b & 0x80) { status = b; q++; } // otherwise running status reuses the last
      const ev = status & 0xf0;
      const ch = status & 0x0f;

      if (status === 0xff) { // meta
        const meta = u8(q++);
        const ln = readVlq();
        if (meta === 0x51 && ln === 3) tempos.push({ tick, us: (u8(q) << 16) | (u8(q + 1) << 8) | u8(q + 2) });
        q += ln;
        status = 0; // system messages cancel running status
      } else if (status === 0xf0 || status === 0xf7) { // sysex
        const skip = readVlq(); // read first: readVlq advances q, so `q += readVlq()` would drop those bytes
        q += skip;
        status = 0; // system messages cancel running status
      } else if (ev === 0x90 || ev === 0x80) { // note on/off
        const pitch = u8(q++);
        const vel = u8(q++);
        const key = (ch << 8) | pitch;
        if (ev === 0x90 && vel > 0) {
          let arr = pending.get(key);
          if (!arr) { arr = []; pending.set(key, arr); }
          arr.push([tick, vel]);
        } else {
          const arr = pending.get(key);
          if (arr && arr.length) {
            const [s, v] = arr.shift() as [number, number];
            notes.push({ channel: ch, pitch, start: s / division, dur: (tick - s) / division, vel: v / 127 });
          }
        }
      } else if (ev === 0xc0 || ev === 0xd0) { // program change / channel pressure: 1 data byte
        q += 1;
      } else { // note aftertouch, controller, pitch bend: 2 data bytes
        q += 2;
      }
    }
  }

  notes.sort((a, b) => a.start - b.start);

  // Pick the dominant tempo — the one active for the most beats — rather than
  // the first or last. MIDIs of pop songs often bookend a steady body with a
  // fast count-in and a slowing outro; those shouldn't set the nominal speed.
  tempos.sort((a, b) => a.tick - b.tick);
  let rawEnd = 0;
  for (const n of notes) rawEnd = Math.max(rawEnd, n.start + n.dur);
  const songEndTick = rawEnd * division;
  let us = tempos.length ? tempos[0].us : 500000;
  let bestSpan = -1;
  for (let i = 0; i < tempos.length; i++) {
    const span = (i + 1 < tempos.length ? tempos[i + 1].tick : songEndTick) - tempos[i].tick;
    if (span > bestSpan) { bestSpan = span; us = tempos[i].us; }
  }
  const bpm = 60000000 / us;

  // Warp multi-tempo files: map each raw beat through the tempo map into real
  // seconds, then back into beats at the dominant tempo. Sections authored at
  // other tempos land between the nominal beat grid but play at their true
  // speed; files with a single uniform tempo pass through unchanged (one
  // segment — the map is identity). The SMF default of 120 BPM applies until
  // the first set_tempo, so a lone late set_tempo still means two segments.
  interface Seg { beat: number; spb: number; sec: number; }
  const segs: Seg[] = [];
  if (!tempos.length || tempos[0].tick > 0) segs.push({ beat: 0, spb: 0.5, sec: 0 });
  for (const t of tempos) segs.push({ beat: t.tick / division, spb: t.us / 1e6, sec: 0 });
  if (segs.length > 1) {
    for (let i = 1; i < segs.length; i++) {
      segs[i].sec = segs[i - 1].sec + (segs[i].beat - segs[i - 1].beat) * segs[i - 1].spb;
    }
    const secAt = (beat: number): number => {
      let i = segs.length - 1;
      while (i > 0 && segs[i].beat > beat) i--;
      return segs[i].sec + (beat - segs[i].beat) * segs[i].spb;
    };
    const scale = bpm / 60; // seconds → dominant-tempo beats
    for (const n of notes) {
      const s = secAt(n.start);
      const e = secAt(n.start + n.dur);
      n.start = s * scale;
      n.dur = Math.max(0, e - s) * scale;
    }
    // The warp is monotonic, so the start-sorted order is preserved.
  }

  // Trim any silent lead-in so playback (and each loop) starts on the first note
  // instead of waiting out an empty count-in.
  const offset = notes.length ? notes[0].start : 0;
  let durationBeats = 0;
  for (const n of notes) {
    n.start -= offset;
    durationBeats = Math.max(durationBeats, n.start + n.dur);
  }

  return { bpm, durationBeats, notes };
}
