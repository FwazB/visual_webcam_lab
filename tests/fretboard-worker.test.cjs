/* eslint-disable @typescript-eslint/no-require-imports -- Executes the actual classic worker and pinned WASM without a browser. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { makeNeckImage, warpImage } = require("./fixtures/neck-images.cjs");

test("classic worker loads same-origin WASM and rejects malformed or obsolete frames", { timeout: 15000 }, async () => {
  const headers = await require("../next.config.ts").default.headers();
  const policy = headers.find(rule => rule.source === "/vision/fretboard-worker.js").headers
    .find(header => header.key === "Content-Security-Policy").value;
  const documentPolicy = headers.find(rule => rule.source === "/(.*)").headers
    .find(header => header.key === "Content-Security-Policy").value;
  assert.match(policy, /connect-src 'none'/);
  assert.doesNotMatch(documentPolicy, /'unsafe-eval'/, "worker code generation must not weaken the page");
  const directory = path.join(__dirname, "../public/vision");
  const messages = [];
  const imports = [];
  let notify;
  const firstMessage = new Promise(resolve => { notify = resolve; });
  const context = vm.createContext({
    console, performance, TextDecoder, TextEncoder, setTimeout, clearTimeout, atob, btoa,
    ArrayBuffer, Uint8Array, Uint8ClampedArray,
    location: { href: "https://local.example/vision/fretboard-worker.js" },
    postMessage(message) { messages.push(message); notify(); },
  }, { codeGeneration: { strings: policy.includes("'unsafe-eval'"), wasm: policy.includes("'unsafe-eval'") || policy.includes("'wasm-unsafe-eval'") } });
  context.self = context;
  context.importScripts = (...urls) => {
    for (const url of urls) {
      assert.ok(["./opencv-4.12.0.js", "./neck-tracker.js", "./neck-detector.js"].includes(url));
      imports.push(url);
      vm.runInContext(fs.readFileSync(path.join(directory, url), "utf8"), context, { filename: url });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(directory, "fretboard-worker.js"), "utf8"), context);
  await firstMessage;
  assert.equal(messages[0].type, "ready", JSON.stringify(messages[0]));
  assert.equal(imports.length, 3);
  context.onmessage({ data: { type: "reset", epoch: 3 } });
  const invalid = { type: "frame", epoch: 3, frameId: 7, capturedAt: 12, mediaTime: 0.1, width: 640, height: 400, rgba: new ArrayBuffer(8) };
  context.onmessage({ data: { ...invalid, epoch: 2 } });
  assert.equal(messages.length, 1, "old reference messages are ignored");
  context.onmessage({ data: invalid });
  assert.equal(messages[1].type, "error");
  assert.equal(messages[1].frameId, 7);
  assert.equal(messages[1].capturedAt, 12, "timestamps are not replaced by worker completion time");
  assert.equal(messages[1].epoch, 3);
  const reference = makeNeckImage();
  context.onmessage({ data: {
    type: "seed", epoch: 4, frameId: 8, capturedAt: 30, mediaTime: .3,
    width: reference.width, height: reference.height, rgba: reference.rgba.buffer,
    points: reference.normalizedPoints,
  } });
  assert.equal(messages.at(-1).type, "seeded");
  assert.equal(messages.at(-1).status, "tracking");
  const destination = reference.points.map(point => ({ x: point.x + 16, y: point.y - 8 }));
  const moved = warpImage(context.cv, reference, destination);
  context.onmessage({ data: {
    type: "frame", epoch: 4, frameId: 9, capturedAt: 500, mediaTime: .5,
    width: moved.width, height: moved.height, rgba: moved.rgba.buffer,
  } });
  const pose = messages.at(-1);
  assert.equal(pose.type, "pose");
  assert.equal(pose.status, "tracking");
  assert.equal(pose.capturedAt, 500);
  pose.points.forEach((point, i) => {
    assert.ok(Math.hypot(point.x * moved.width - destination[i].x, point.y * moved.height - destination[i].y) < 4);
  });
  context.onmessage({ data: { type: "reset", epoch: 5 } });
});
