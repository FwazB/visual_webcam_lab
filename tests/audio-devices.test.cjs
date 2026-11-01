/* eslint-disable @typescript-eslint/no-require-imports -- Executes the real helper with isolated browser API mocks. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(fs.readFileSync(require.resolve("../src/lib/audio/devices.ts"), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const flush = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const spark = { kind: "audioinput", deviceId: "spark", label: "Spark PEDAL" };
function stream() {
  let stops = 0;
  return { getTracks: () => [{ stop: () => { stops++; } }], stops: () => stops };
}
function load(mediaDevices) {
  const loaded = { exports: {} };
  vm.runInNewContext(source, { exports: loaded.exports, module: loaded, DOMException, navigator: { mediaDevices } });
  return loaded.exports.listAudioInputs;
}
const isAbort = (error) => error.name === "AbortError";

test("normal discovery releases its permission probe and returns only audio inputs", async () => {
  const probe = stream();
  let enumerations = 0;
  const list = load({
    enumerateDevices: async () => ++enumerations === 1 ? [] : [spark, { kind: "videoinput" }],
    getUserMedia: async (constraints) => {
      assert.equal(constraints.audio, true);
      assert.equal(constraints.video, false);
      return probe;
    },
  });
  const result = await list();
  assert.equal(result.length, 1);
  assert.equal(result[0], spark);
  assert.equal(probe.stops(), 1);
});

test("labeled devices do not open a permission probe", async () => {
  const list = load({
    enumerateDevices: async () => [spark],
    getUserMedia: async () => assert.fail("capture is unnecessary"),
  });
  assert.equal((await list(new AbortController().signal))[0], spark);
});

test("already canceled discovery never calls a browser media API", async () => {
  const controller = new AbortController();
  controller.abort();
  const list = load({
    enumerateDevices: async () => assert.fail("canceled enumeration"),
    getUserMedia: async () => assert.fail("canceled capture"),
  });
  await assert.rejects(list(controller.signal), isAbort);
});

test("cancellation during initial enumeration rejects promptly and prevents a later permission prompt", async () => {
  const initial = deferred();
  let enumerations = 0;
  const list = load({
    enumerateDevices: () => { enumerations++; return initial.promise; },
    getUserMedia: async () => assert.fail("must not prompt after cancellation"),
  });
  const controller = new AbortController();
  const canceled = assert.rejects(list(controller.signal), isAbort);
  controller.abort();
  await canceled;
  initial.resolve([]);
  await flush();
  assert.equal(enumerations, 1);
});

test("a permission grant arriving after cancellation is stopped before any further enumeration", async () => {
  const grant = deferred();
  const probe = stream();
  let enumerations = 0;
  const list = load({
    enumerateDevices: async () => { enumerations++; return []; },
    getUserMedia: () => grant.promise,
  });
  const controller = new AbortController();
  const canceled = assert.rejects(list(controller.signal), isAbort);
  await flush();
  controller.abort();
  await canceled;
  grant.resolve(probe);
  await flush();
  assert.equal(probe.stops(), 1);
  assert.equal(enumerations, 1);
});

test("abort immediately releases a probe while enumeration waits, exactly once", async () => {
  const second = deferred();
  const probe = stream();
  let enumerations = 0;
  const list = load({
    enumerateDevices: () => ++enumerations === 1 ? Promise.resolve([]) : second.promise,
    getUserMedia: async () => probe,
  });
  const controller = new AbortController();
  const canceled = assert.rejects(list(controller.signal), isAbort);
  await flush();
  assert.equal(enumerations, 2);
  assert.equal(probe.stops(), 0);
  controller.abort();
  assert.equal(probe.stops(), 1);
  controller.abort();
  await canceled;
  second.resolve([spark]);
  await flush();
  assert.equal(probe.stops(), 1);
});

test("enumeration errors release an acquired probe", async () => {
  const probe = stream();
  let enumerations = 0;
  const list = load({
    enumerateDevices: async () => {
      if (++enumerations === 2) throw new Error("enumeration failed");
      return [];
    },
    getUserMedia: async () => probe,
  });
  await assert.rejects(list(), /enumeration failed/);
  assert.equal(probe.stops(), 1);
});
