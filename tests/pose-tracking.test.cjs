/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Node hook tests use the CommonJS TypeScript bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

function setup(vision) {
  const states = [];
  const effects = [];
  const react = {
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const i = states.length;
      states.push(initial);
      return [initial, (next) => { states[i] = next; }];
    },
    useEffect: (effect) => effects.push(effect),
    useCallback: (callback) => callback,
  };
  const source = fs.readFileSync(require.resolve("../src/hooks/usePoseTracking.ts"), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => name === "react" ? react : vision, loaded, loaded.exports);
  loaded.exports.usePoseTracking({ current: null });
  return { states, cleanup: effects[0]() };
}

test("failed WASM loading clears the spinner and exposes a safe error", async () => {
  let creates = 0;
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => { throw new Error("private URL / token"); } },
    HandLandmarker: { createFromOptions: async () => { creates++; } },
  });
  await new Promise(setImmediate);
  assert.equal(run.states[1], false);
  assert.match(run.states[2], /Hand tracking could not start/);
  assert.doesNotMatch(run.states[2], /private|token/);
  assert.equal(creates, 0);
  run.cleanup();
});

test("failed GPU/model initialization clears loading instead of rejecting unhandled", async () => {
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => { throw new Error("GPU unavailable"); } },
  });
  await new Promise(setImmediate);
  assert.equal(run.states[1], false);
  assert.match(run.states[2], /audio practice still works/);
  run.cleanup();
});

test("a detector created after unmount is closed without updating state", async () => {
  let finish;
  let closed = 0;
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: () => new Promise((resolve) => { finish = resolve; }) },
  });
  await new Promise(setImmediate);
  run.cleanup();
  finish({ close: () => { closed++; } });
  await new Promise(setImmediate);
  assert.equal(closed, 1);
  assert.equal(run.states[1], true);
  assert.equal(run.states[2], null);
});

test("normal unmount releases the detector exactly once", async () => {
  let closed = 0;
  const run = setup({
    FilesetResolver: { forVisionTasks: async () => ({}) },
    HandLandmarker: { createFromOptions: async () => ({ close: () => { closed++; } }) },
  });
  await new Promise(setImmediate);
  assert.equal(run.states[1], false);
  assert.equal(run.states[2], null);
  run.cleanup();
  run.cleanup();
  assert.equal(closed, 1);
});
