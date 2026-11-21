/* eslint-disable @typescript-eslint/no-require-imports -- Uses the repository TypeScript test bootstrap. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { headTiltAmount, readTiltStep } = require("../src/lib/headMotionGestures");
const { renderCameraTrails } = require("../src/lib/cameraTrails");

test("continuous motion has a quiet center and saturates toward either shoulder", () => {
  assert.deepEqual([null, -180, -14, -3, 0, 3, 14, 25, 180].map(headTiltAmount),
    [0, -1, -0.5, 0, 0, 0, 0.5, 1, 1]);
});

test("discrete gestures fire once per excursion and rearm only on a fresh center", () => {
  let armed = false;
  const steps = [20, 0, 10, 17, 20, -20, 3, -16, null, -16, 0, 15].map((degrees) => {
    const gesture = readTiltStep(armed, degrees);
    armed = gesture.armed;
    return gesture.step;
  });
  assert.deepEqual(steps, [0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 0, 1]);
});

test("browser Fuzz blends fresh frames, restores the baseline, and releases a late camera grant", async (t) => {
  const session = new AbortController();
  const track = new EventTarget();
  let stopped = 0;
  track.stop = () => stopped++;
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  let grant;
  const mediaDevices = { getUserMedia: (constraints) => {
    assert.equal(constraints.audio, false);
    return new Promise(resolve => { grant = resolve; });
  } };
  const saved = ["navigator", "requestAnimationFrame", "cancelAnimationFrame"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  Object.defineProperty(globalThis, "navigator", { value: { mediaDevices }, configurable: true });
  let nextFrame;
  globalThis.requestAnimationFrame = fn => { nextFrame = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { nextFrame = undefined; };
  const player = { readyState: 3, currentTime: 0, videoWidth: 640, videoHeight: 360, async play() {} };
  const blends = [];
  const ctx = { setTransform() {}, clearRect() {}, drawImage() { blends.push(this.globalAlpha); } };
  const canvas = { getContext: () => ctx, ownerDocument: { createElement: () => player } };
  let amount = 0;
  const start = signal => renderCameraTrails(canvas, signal, () => amount, () => {});
  const live = start(session.signal);
  grant(stream);
  await live;
  nextFrame(); // no second blend for the same frame
  assert.deepEqual(blends, [1]);
  for (amount of [0, 1, 0]) { player.currentTime += 1 / 30; nextFrame(); }
  assert.ok(blends[2] < blends[1] / 5);
  assert.ok(Math.abs(blends[3] - blends[1]) < 1e-6);
  session.abort();
  assert.equal(player.srcObject, null);
  assert.equal(nextFrame, undefined);
  assert.equal(stopped, 1);
  const pending = new AbortController();
  const late = start(pending.signal);
  pending.abort();
  grant(stream);
  await late;
  assert.equal(stopped, 2);
  assert.equal(player.srcObject, null);
});
