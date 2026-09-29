/* eslint-disable @typescript-eslint/no-require-imports -- Runs in Node's CommonJS test runner with tests/register.cjs. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const P = require("../src/lib/studio/project");
const { encodeWav, computePeaks } = require("../src/lib/studio/audio");
const { hitTest, RULER_H, ROW_H } = require("../src/lib/studio/timeline");

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function project() {
  const base = { ...P.emptyProject(), bpm: 120 };
  const a = { ...P.makeTrack(base, "A"), id: "a" };
  const b = { ...P.makeTrack(P.addTrack(base, a), "B"), id: "b" };
  let p = P.addTrack(P.addTrack(base, a), b);
  p = P.addClip(p, { id: "c1", trackId: "a", bufferId: "buf", name: "Take 1", start: 2, offset: 0.5, duration: 4 });
  return p;
}

test("moving, trimming and splitting a clip stay within its audio", () => {
  let p = project();
  p = P.moveClip(p, "c1", -1, "b");
  assert.equal(p.clips[0].start, 0);
  assert.equal(p.clips[0].trackId, "b");

  p = project();
  const early = P.trimClipStart(p, "c1", 0).clips[0];
  near(early.start, 1.5); // only 0.5 s of audio exists before the clip
  near(early.offset, 0);
  near(early.duration, 4.5);
  const late = P.trimClipStart(p, "c1", 3).clips[0];
  near(late.offset, 1.5);
  near(late.duration, 3);

  const longest = P.trimClipEnd(p, "c1", 100, 6).clips[0];
  near(longest.duration, 5.5); // buffer is 6 s, offset 0.5
  near(P.trimClipEnd(p, "c1", 2, 6).clips[0].duration, P.MIN_CLIP);

  const split = P.splitClip(p, "c1", 3, "c2").clips;
  assert.deepEqual(split.map((c) => [c.id, c.start, c.offset, c.duration]), [["c1", 2, 0.5, 1], ["c2", 3, 1.5, 3]]);
  assert.equal(P.splitClip(p, "c1", 2.01, "c2"), p);
});

test("a new take carves out the audio under it on its track only", () => {
  let p = project();
  p = P.addClip(p, { id: "other", trackId: "b", bufferId: "buf", name: "B", start: 2, offset: 0, duration: 4 });
  const carved = P.carveOut(p, "a", 3, 4, "right");
  const onA = carved.clips.filter((c) => c.trackId === "a").map((c) => [c.id, c.start, c.offset, c.duration]);
  assert.deepEqual(onA, [["c1", 2, 0.5, 1], ["right", 4, 2.5, 2]]);
  assert.equal(carved.clips.find((c) => c.id === "other").duration, 4);
  assert.equal(P.carveOut(p, "a", 0, 10, "x").clips.filter((c) => c.trackId === "a").length, 0);
});

test("recorded takes before the timeline origin are trimmed", () => {
  assert.deepEqual(P.placeTake(1, 3), { start: 1, offset: 0, duration: 3 });
  const early = P.placeTake(-0.02, 3);
  near(early.start, 0);
  near(early.offset, 0.02);
  near(early.duration, 2.98);
});

test("snap, position and mute/solo helpers", () => {
  near(P.snap(0.61, 120), 0.5);
  near(P.snap(0.13, 120, 4), 0.125);
  assert.deepEqual(P.formatPosition(2.5, 120, 4), { bars: "2.2", clock: "0:02.5" });
  const p = project();
  assert.equal(P.effectiveGain(p.tracks[0], false), 1);
  assert.equal(P.effectiveGain({ ...p.tracks[0], muted: true }, false), 0);
  assert.equal(P.effectiveGain(p.tracks[0], true), 0);
  assert.equal(P.effectiveGain({ ...p.tracks[0], solo: true }, true), 1);
  near(P.projectEnd(p), 6);
});

test("undo history coalesces keyed edits and clears redo on a new edit", () => {
  const p0 = project();
  let h = { past: [], present: p0, future: [] };
  const v = (h, volume) => P.commit(h, P.updateTrack(h.present, "a", { volume }), "volume:a");
  h = v(h, 0.9);
  h = v(h, 0.8);
  h = v(h, 0.7);
  assert.equal(h.past.length, 1);
  h = P.commit(h, P.deleteClip(h.present, "c1"));
  assert.equal(h.past.length, 2);
  h = P.undo(h);
  assert.equal(h.present.clips.length, 1);
  assert.equal(h.present.tracks[0].volume, 0.7);
  h = P.undo(h);
  assert.equal(h.present, p0);
  h = P.redo(h);
  assert.equal(h.present.tracks[0].volume, 0.7);
  h = P.commit(h, P.moveClip(h.present, "c1", 5));
  assert.equal(h.future.length, 0);
});

test("WAV export writes a 16-bit PCM header and clamped interleaved samples", () => {
  const wav = new DataView(encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 2, -2])], 48000));
  const text = (at, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => wav.getUint8(at + i)));
  assert.equal(text(0, 4), "RIFF");
  assert.equal(text(8, 4), "WAVE");
  assert.equal(wav.getUint16(22, true), 2);
  assert.equal(wav.getUint32(24, true), 48000);
  assert.equal(wav.getUint32(40, true), 12);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => wav.getInt16(44 + i * 2, true)), [0, 16383, 32767, 32767, -32768, -32768]);
});

test("peaks take the loudest sample of every channel per bucket", () => {
  const peaks = computePeaks([new Float32Array([0.1, -0.5, 0.2, 0]), new Float32Array([0, 0, -0.9, 0])], 4, 2);
  assert.deepEqual(Array.from(peaks, (v) => Math.round(v * 10) / 10), [0.5, 0.9]);
});

test("timeline hit-testing finds the ruler, clip bodies, clip edges and lanes", () => {
  const p = project();
  const view = { scrollX: 0, pxPerSec: 50, width: 800, height: 300 };
  assert.equal(hitTest(p, view, 10, 5).kind, "ruler");
  const row0 = RULER_H + ROW_H / 2;
  assert.deepEqual(hitTest(p, view, 102, row0), { kind: "clip", clipId: "c1", edge: "start", t: 2.04 });
  assert.equal(hitTest(p, view, 200, row0).edge, null);
  assert.equal(hitTest(p, view, 298, row0).edge, "end");
  assert.equal(hitTest(p, view, 50, row0).kind, "lane");
  assert.equal(hitTest(p, view, 200, RULER_H + ROW_H * 1.5).kind, "lane");
  assert.equal(hitTest(p, view, 200, RULER_H + ROW_H * 5).kind, "empty");
});

test("the recorder worklet captures from the requested frame and flushes on stop", () => {
  const messages = [];
  let Processor;
  const context = {
    currentFrame: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (m) => messages.push(m) }; } },
    registerProcessor: (_, ctor) => { Processor = ctor; },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/worklets/recorder-processor.js"), "utf8"), context);
  const rec = new Processor();
  const block = (start) => [Float32Array.from({ length: 128 }, (_, i) => start + i), Float32Array.from({ length: 128 }, (_, i) => -(start + i))];
  const run = (blocks) => {
    for (let b = 0; b < blocks; b++) {
      rec.process([block(context.currentFrame)]);
      context.currentFrame += 128;
    }
  };
  run(2); // not recording yet
  rec.port.onmessage({ data: { type: "start", frame: 300 } });
  run(70); // frames 256..9215: records 300..9215 = 8916 frames, one 8192+ chunk flushed
  rec.port.onmessage({ data: { type: "stop" } });
  const data = messages.filter((m) => m.type === "data");
  assert.equal(messages.at(-1).type, "stopped");
  const left = data.flatMap((m) => Array.from(m.channels[0]));
  const right = data.flatMap((m) => Array.from(m.channels[1]));
  assert.equal(left.length, 9216 - 300);
  assert.equal(left[0], 300);
  assert.equal(left.at(-1), 9215);
  assert.equal(right[0], -300);
  assert.ok(data.length >= 2);
  run(4);
  assert.equal(messages.filter((m) => m.type === "data").length, data.length);
});
