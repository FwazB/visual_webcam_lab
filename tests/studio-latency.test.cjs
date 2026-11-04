/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the hook without a browser. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

const prefix = "bodysynth.studio.latencyMs.input:";
function harness(storage = new Map(), blocked = false) {
  const slots = [];
  let index = 0;
  const memo = (calculate, dependencies) => {
    const slot = index++;
    if (!slots[slot] || dependencies.some((value, i) => value !== slots[slot].dependencies[i])) {
      slots[slot] = { value: calculate(), dependencies };
    }
    return slots[slot].value;
  };
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], value => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ??= { current: initial }; },
    useMemo: memo, useCallback: (callback, dependencies) => memo(() => callback, dependencies),
  };
  const source = fs.readFileSync(require.resolve("../src/hooks/useStudioLatency.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  const localStorage = {
    getItem(key) { if (blocked) throw Error("Storage blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error("Storage blocked"); storage.set(key, value); },
    removeItem(key) { if (blocked) throw Error("Storage blocked"); storage.delete(key); },
  };
  new Function("require", "module", "exports", "localStorage", compiled)(() => react, loaded, loaded.exports, localStorage);
  return { render(deviceId) {
    index = 0;
    const result = loaded.exports.useStudioLatency(deviceId);
    return result;
  } };
}

test("manual latency belongs to one input, survives switching/reload, and ignores the legacy global value", () => {
  const storage = new Map([["bodysynth.studio.latencyMs", "69"]]);
  const hook = harness(storage);
  let mic = hook.render("Mac / microphone");
  assert.equal(mic.latencyMs, null);
  mic.setLatencyMs(69);
  mic = hook.render("Mac / microphone");
  assert.equal(mic.latencyMs, 69);
  const pendingRecordingValue = mic.getLatencyMs;
  let spark = hook.render("Spark");
  assert.equal(spark.latencyMs, null, "a microphone calibration must not apply to Spark");
  assert.equal(pendingRecordingValue("Spark"), null, "an older recording closure reads the attached input's compensation");
  spark.setLatencyMs(12);
  spark = hook.render("Spark");
  assert.equal(spark.latencyMs, 12);
  assert.equal(hook.render("Mac / microphone").latencyMs, 69);
  assert.equal(storage.get(prefix + encodeURIComponent("Mac / microphone")), "69");
  const reloaded = harness(storage);
  assert.equal(reloaded.render("Spark").latencyMs, 12);
  assert.equal(reloaded.render("Mac / microphone").latencyMs, 69);
});

test("a newly attached input resolves its saved calibration before the next render", () => {
  const storage = new Map([[prefix + "mic", "69"], [prefix + "spark", "12"]]);
  const hook = harness(storage);
  const mic = hook.render("mic");
  assert.equal(mic.latencyMs, 69);
  // Connection resolves synchronously, but the displayed hook still belongs to mic.
  assert.equal(mic.getLatencyMs("spark"), 12);
  assert.equal(mic.getLatencyMs("other-input"), null);
  mic.setLatencyMs(70);
  assert.equal(mic.getLatencyMs("mic"), 70, "manual edits are also available before React rerenders");
  assert.equal(mic.getLatencyMs("spark"), 12);
});

test("blank clears only the selected input and explicit zero remains a manual setting", () => {
  const storage = new Map();
  const hook = harness(storage);
  hook.render("mic").setLatencyMs(69);
  hook.render("spark").setLatencyMs(0);
  assert.equal(hook.render("spark").latencyMs, 0);
  hook.render("mic").setLatencyMs(null);
  assert.equal(hook.render("mic").latencyMs, null);
  assert.equal(hook.render("spark").latencyMs, 0);
  assert.equal(storage.has(prefix + "mic"), false);
  assert.equal(storage.get(prefix + "spark"), "0");
  hook.render(null).setLatencyMs(123);
  assert.equal(hook.render(null).latencyMs, null);
  assert.equal(storage.size, 1);
});

test("blocked storage keeps per-input session values; invalid stored values fall back to automatic", () => {
  const hook = harness(new Map(), true);
  hook.render("mic").setLatencyMs(69);
  assert.equal(hook.render("spark").latencyMs, null);
  assert.equal(hook.render("mic").latencyMs, 69);
  hook.render("mic").setLatencyMs(null);
  assert.equal(hook.render("mic").latencyMs, null);
  for (const value of ["", "NaN", "Infinity", "-1", "501", "69.5"]) {
    assert.equal(harness(new Map([[prefix + "mic", value]])).render("mic").latencyMs, null);
  }
});
