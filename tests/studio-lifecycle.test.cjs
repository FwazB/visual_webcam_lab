/* eslint-disable @typescript-eslint/no-require-imports -- Execute production hooks and async actions without media devices or a browser. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { StudioEngine } = require("../src/lib/studio/engine");
const projectModel = require("../src/lib/studio/project");

const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const flush = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function stream() {
  let stopped = 0;
  const track = { readyState: "live", enabled: true, muted: false, stop() { stopped++; this.readyState = "ended"; } };
  return { getTracks: () => [track], getAudioTracks: () => [track], stopped: () => stopped };
}

function hookHarness(options = {}) {
  const effects = [], states = [], requests = [], enumerationSignals = [], timers = new Map();
  let creates = 0, updates = 0;
  const engine = {
    hasInput: false, inputMuted: false, level: null, attached: [], closed: 0,
    ctx: { state: options.paused ? "suspended" : "running" },
    resume() {
      if (options.paused) return Promise.reject(new Error("Audio paused"));
      this.ctx.state = "running";
      return Promise.resolve();
    },
    getInputLevel() { return this.hasInput && !this.inputMuted && this.ctx.state === "running" ? this.level : null; },
    attachInput(input) { if (options.attachThrows) throw new Error("Attachment failed"); this.attached.push(input); this.current = input; this.hasInput = true; },
    estimatedLatency: () => 0,
    close() { this.closed++; this.current?.getTracks().forEach(track => track.stop()); },
  };
  const react = {
    useRef: current => ({ current }), useCallback: fn => fn, useEffect: fn => effects.push(fn),
    useState: initial => { const i = states.length; states.push(initial); return [initial, value => { updates++; states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
  };
  const loaded = { exports: {} };
  const source = fs.readFileSync(require.resolve("../src/hooks/useStudioEngine.ts"), "utf8");
  new Function("require", "module", "exports", "navigator", "window", compile(source))(
    name => name === "react" ? react : name === "@/lib/studio/engine" ? {
      StudioEngine: { create: () => { creates++; return options.creation?.promise ?? Promise.resolve(engine); } },
    } : {
      instrumentConstraints: id => ({ id }), storeDevice() {},
      listAudioInputs: signal => { enumerationSignals.push(signal); return options.enumeration?.promise ?? Promise.resolve([{ deviceId: "synthetic-input" }]); },
      pickPreferredDevice: list => list[0] ?? null,
    }, loaded, loaded.exports,
    { mediaDevices: { getUserMedia: constraints => { const request = deferred(); requests.push({ ...request, id: constraints.id }); return request.promise; } } },
    { setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); } },
  );
  const hook = loaded.exports.useStudioEngine();
  const cleanup = effects[0]();
  return { hook, cleanup, states, engine, requests, enumerationSignals, timers, tick: () => timers.forEach(fn => fn()), get creates() { return creates; }, get updates() { return updates; } };
}

test("Studio releases microphone permission granted after unmount", async () => {
  const run = hookHarness();
  run.hook.selectDevice("synthetic-input");
  await flush();
  assert.equal(run.requests.length, 1);
  run.cleanup();
  const updates = run.updates;
  const late = stream();
  run.requests[0].resolve(late);
  await flush();
  assert.equal(late.stopped(), 1);
  assert.equal(run.engine.attached.length, 0);
  assert.equal(run.engine.closed, 1);
  assert.equal(run.updates, updates);
});

test("Studio creates audio in the click before discovery and rejects late enumeration after unmount", async () => {
  const enumeration = deferred();
  const run = hookHarness({ enumeration });
  const pending = run.hook.connect();
  assert.equal(run.creates, 1, "audio activation starts before asynchronous device discovery");
  run.cleanup();
  assert.equal(run.enumerationSignals[0].aborted, true);
  enumeration.resolve([{ deviceId: "synthetic-input" }]);
  await pending;
  assert.equal(run.creates, 1);
  assert.equal(run.engine.closed, 1);
  assert.equal(run.requests.length, 0);
  await assert.rejects(run.hook.ensureEngine(), /no longer open/);
  assert.equal(run.timers.size, 0);
});

test("Studio aborts a temporary permission probe on cancel and a newer device selection", async () => {
  for (const action of ["cancel", "select", "connect"]) {
    const enumeration = deferred();
    const run = hookHarness({ enumeration });
    const pending = run.hook.connect();
    const signal = run.enumerationSignals[0];
    if (action === "cancel") run.hook.cancelPendingInput();
    else if (action === "select") run.hook.selectDevice("newer-input");
    else void run.hook.connect();
    assert.equal(signal.aborted, true);
    run.cleanup();
    enumeration.resolve([]);
    await pending;
    await flush();
  }
});

test("Studio closes a late-created engine without requesting capture", async () => {
  const creation = deferred();
  const run = hookHarness({ creation });
  run.hook.selectDevice("synthetic-input");
  run.cleanup();
  creation.resolve(run.engine);
  await flush();
  assert.equal(run.engine.closed, 1);
  assert.equal(run.requests.length, 0);
  assert.equal(run.hook.engineRef.current, null);
});

test("superseded device grants cannot replace the latest selected input", async () => {
  const run = hookHarness();
  run.hook.selectDevice("older-input");
  await flush();
  run.hook.selectDevice("newer-input");
  await flush();
  const old = stream(), current = stream();
  run.requests[1].resolve(current);
  await flush();
  run.requests[0].resolve(old);
  await flush();
  assert.deepEqual(run.engine.attached, [current]);
  assert.equal(old.stopped(), 1);
  assert.equal(run.states[3], "newer-input");
  run.cleanup();
  assert.equal(current.stopped(), 1);
});

test("cancelling input or an attachment failure releases the newly granted stream", async () => {
  for (const attachThrows of [false, true]) {
    const run = hookHarness({ attachThrows });
    run.hook.selectDevice("synthetic-input");
    await flush();
    if (!attachThrows) run.hook.cancelPendingInput();
    const input = stream();
    run.requests[0].resolve(input);
    await flush();
    assert.equal(input.stopped(), 1);
    assert.equal(run.engine.attached.length, 0);
    assert.equal(run.states[0], attachThrows ? "error" : "off");
    run.cleanup();
  }
});

test("Studio distinguishes paused capture, right-channel signal, muting, and disconnection", async () => {
  const options = { paused: true };
  const run = hookHarness(options);
  const connecting = run.hook.connect();
  await flush();
  run.requests[0].resolve(stream());
  await connecting;
  assert.equal(run.states[0], "suspended", "connected does not imply the audio clock is running");
  assert.equal(run.states[5], null);
  assert.equal(run.states[6], true);

  options.paused = false;
  await run.hook.resumeAudio();
  assert.equal(run.states[0], "ready");
  assert.equal(run.states[6], false);
  run.engine.level = { peaks: [0, 0.7], rms: [0, 0.35] };
  run.tick();
  assert.deepEqual(run.states[5], { peak: 0.7, rms: 0.35, channels: 2 });

  run.engine.inputMuted = true;
  run.tick();
  assert.equal(run.states[0], "muted");
  assert.equal(run.states[5], null);
  run.engine.inputMuted = false;
  run.tick();
  assert.equal(run.states[0], "ready");
  run.engine.hasInput = false;
  run.tick();
  assert.equal(run.states[0], "error");
  assert.match(run.states[1], /disconnected/);
  assert.equal(run.states[5], null);
  run.cleanup();
  assert.equal(run.timers.size, 0);
});

test("the attached input identity is available before the selected-device rerender", async () => {
  const run = hookHarness();
  const pending = run.hook.connect();
  await flush();
  run.requests[0].resolve(stream());
  await pending;
  assert.equal(run.hook.deviceId, null, "this harness has not rerendered the hook");
  assert.equal(run.hook.getConnectedDeviceId(), "synthetic-input");
  run.engine.hasInput = false;
  assert.equal(run.hook.getConnectedDeviceId(), null);
  run.cleanup();
});

test("a superseded audio activation cannot overwrite the next input or a newer activation", async () => {
  for (const replacement of ["input", "activation"]) {
    const run = hookHarness();
    run.hook.selectDevice("first-input");
    await flush();
    run.requests[0].resolve(stream());
    await flush();
    const oldResume = deferred();
    run.engine.resume = () => oldResume.promise;
    const previous = run.hook.resumeAudio();
    run.engine.resume = () => Promise.resolve();
    if (replacement === "input") {
      run.hook.selectDevice("new-input");
      await flush();
      run.requests[1].resolve(stream());
      await flush();
      assert.equal(run.states[3], "new-input");
    } else await run.hook.resumeAudio();
    oldResume.reject(new Error("Previous activation failed"));
    await previous;
    assert.equal(run.states[0], "ready");
    assert.equal(run.states[1], null);
    run.cleanup();
  }
});

test("a replacement audio engine clears the old connection while preserving an active reconnect", async () => {
  for (const reconnect of [false, true]) {
    const options = {};
    const run = hookHarness(options);
    run.hook.selectDevice("old-input");
    await flush();
    run.requests[0].resolve(stream());
    await flush();
    run.engine.level = { peaks: [0.4], rms: [0.2] };
    run.tick();
    run.engine.ctx.state = "closed";
    run.tick();
    assert.equal(run.states[0], "error", "closed audio is not merely paused or ready");
    const replacement = { ...run.engine, ctx: { state: "running" }, hasInput: false, level: null, current: null, attached: [], closed: 0 };
    options.creation = { promise: Promise.resolve(replacement) };
    const pending = reconnect ? run.hook.connect() : run.hook.ensureEngine();
    await flush();
    assert.equal(run.states[3], null);
    assert.equal(run.states[5], null);
    assert.equal(run.states[0], reconnect ? "connecting" : "off");
    if (reconnect) run.requests[1].resolve(stream());
    await pending;
    run.tick();
    assert.equal(run.states[0], reconnect ? "ready" : "off");
    assert.equal(replacement.hasInput, reconnect);
    run.cleanup();
  }
});

test("the actual Studio engine releases input when graph creation or connection fails", () => {
  for (const failure of ["closed", "create", "connect"]) {
    const engine = Object.create(StudioEngine.prototype);
    let disconnected = 0;
    Object.assign(engine, { input: null, stream: null, inputGeneration: 0, closed: failure === "closed", recorder: { port: { postMessage() {} } }, ctx: {
      state: failure === "closed" ? "closed" : "running",
      createMediaStreamSource() {
        if (failure === "create") throw new Error("Create failed");
        return { connect() { throw new Error("Connect failed"); }, disconnect() { disconnected++; } };
      },
    } });
    const input = stream();
    assert.throws(() => engine.attachInput(input));
    assert.equal(input.stopped(), 1);
    assert.equal(engine.stream, null);
    assert.equal(engine.input, null);
    if (failure === "connect") assert.equal(disconnected, 1);
  }
});

const componentSource = fs.readFileSync(require.resolve("../src/components/Studio.tsx"), "utf8");
const componentTree = ts.createSourceFile("Studio.tsx", componentSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
const functions = {}, effectSources = {};
let projectGuard;
(function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions[node.name.text] = node.getText(componentTree);
  if (ts.isVariableDeclaration(node) && node.name.getText(componentTree) === "isCurrentProject") {
    projectGuard = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0].getText(componentTree) : node.initializer.getText(componentTree);
  }
  if (ts.isCallExpression(node) && node.expression.getText(componentTree) === "useEffect") {
    const source = node.arguments[0].getText(componentTree);
    if (source.includes("mountedRef.current = true")) effectSources.lifetime = source;
    if (source.includes("loadStudio()")) effectSources.restore = source;
  }
  ts.forEachChild(node, visit);
})(componentTree);

function componentHarness(options = {}) {
  const events = [], notices = [], stored = [], actions = [];
  const decoding = deferred(), loading = options.loading ?? deferred();
  const engine = { mode: "stopped", hasInput: true, ctx: { sampleRate: 48000 },
    resume: () => options.resume?.promise ?? Promise.resolve(),
    decode: () => decoding.promise, seek() {}, stop: async () => null, position: () => 0,
    play() { events.push("play"); }, record() { events.push("record"); },
  };
  const values = {
    ...projectModel,
    mountedRef: { current: true }, projectGenerationRef: { current: 0 }, transportRequestRef: { current: 0 }, restoreRef: { current: null },
    project: projectModel.emptyProject(), armedTrackId: null,
    getLatencyMs: id => options.getLatencyMs ? options.getLatencyMs(id) : options.latency?.value ?? null, countIn: false,
    recordingRef: { current: null }, engineRef: { current: engine },
    buffersRef: { current: new Map() }, peaksRef: { current: new Map() }, playheadRef: { current: 0 }, scrollXRef: { current: 0 },
    studio: { connect: async () => {}, cancelPendingInput() { events.push("cancel-input"); }, refreshLatency: () => 0, getConnectedDeviceId: () => "synthetic-input" },
    ensureEngine: () => options.creation?.promise ?? Promise.resolve(engine),
    options: () => ({ bpm: 96, beatsPerBar: 4, metronome: false }),
    setBusy(value) { events.push(`busy:${value}`); }, setConfirmNew() {}, setSelectedClipId() {}, setArmedTrackId() {}, setMode() {}, setLoaded() {},
    setNotice: value => notices.push(value), message: String,
    registerBuffer() { events.push("register"); }, channelsOf: () => [new Float32Array(1)], toAudioBuffer: () => ({}),
    saveBuffer: async buffer => { stored.push(buffer); events.push("save-buffer"); },
    clearStudio: async () => { stored.length = 0; events.push("clear"); },
    loadStudio: () => loading.promise,
    dispatch: action => { actions.push(action); events.push(`dispatch:${action.type}`); },
    renderMix: () => options.rendering?.promise,
    URL: { createObjectURL() { events.push("download-url"); return "blob:synthetic"; }, revokeObjectURL() {} },
    Blob: class {}, encodeWav: () => new ArrayBuffer(0),
    document: { createElement: () => ({ click() { events.push("download"); } }) }, window: { setTimeout() {} },
  };
  const names = ["play", "record", "stop", "addTake", "importFile", "newProject", "exportMix"];
  const source = `const isCurrentProject = ${projectGuard};\n${names.map(name => functions[name]).join("\n")}\nreturn { ${names.join(",")}, lifetime: ${effectSources.lifetime}, restore: ${effectSources.restore} };`;
  const actionsUnderTest = new Function(...Object.keys(values), compile(source))(...Object.values(values));
  const unmount = actionsUnderTest.lifetime();
  return { ...actionsUnderTest, values, engine, events, notices, stored, actions, decoding, loading, unmount };
}

const file = { name: "synthetic.wav", arrayBuffer: async () => new ArrayBuffer(4) };
const buffer = { sampleRate: 48000, duration: 1 };

test("New cancels a pending audio import before it can restore discarded private data", async () => {
  const run = componentHarness();
  const importing = run.importFile(file);
  await flush();
  await run.newProject();
  run.decoding.resolve(buffer);
  await importing;
  assert.equal(run.stored.length, 0);
  assert.equal(run.events.includes("register"), false);
  assert.deepEqual(run.actions.map(action => action.type), ["load"]);
  assert.ok(run.events.includes("clear"));
  run.unmount();
});

test("unmount during import decoding prevents persistence and state updates", async () => {
  const run = componentHarness();
  const importing = run.importFile(file);
  await flush();
  run.unmount();
  const events = [...run.events];
  run.decoding.resolve(buffer);
  await importing;
  assert.deepEqual(run.events, events);
  assert.equal(run.stored.length, 0);
  assert.equal(run.actions.length, 0);
});

test("New waits for an obsolete restore and never loads its previous private recordings", async () => {
  const run = componentHarness();
  const cancelRestore = run.restore();
  const clearing = run.newProject();
  await flush();
  assert.equal(run.events.includes("clear"), false);
  run.loading.resolve({ project: { tracks: [], clips: [{ bufferId: "old" }] }, buffers: [{ id: "old", channels: [], sampleRate: 48000 }] });
  await clearing;
  assert.equal(run.events.includes("register"), false);
  assert.deepEqual(run.actions.map(action => action.project), [projectModel.emptyProject()]);
  assert.ok(run.events.includes("clear"));
  cancelRestore();
  run.unmount();
});

test("New discards an in-progress take without writing a final recording during deletion", async () => {
  const run = componentHarness();
  run.engine.mode = "recording";
  run.engine.stop = async () => ({ channels: [new Float32Array(1)], sampleRate: 48000, start: 0 });
  run.values.recordingRef.current = { trackId: "old-track" };
  await run.newProject();
  assert.equal(run.events.includes("save-buffer"), false);
  assert.equal(run.events.includes("register"), false);
  run.unmount();
});

test("obsolete export and transport continuations do not download or start after navigation", async () => {
  const rendering = deferred();
  const run = componentHarness({ rendering });
  const exporting = run.exportMix();
  run.unmount();
  rendering.resolve(buffer);
  await exporting;
  assert.equal(run.events.includes("download"), false);

  for (const action of ["play", "record"]) {
    const creation = deferred();
    const pending = componentHarness({ creation });
    const operation = pending[action]();
    pending.unmount();
    creation.resolve(pending.engine);
    await operation;
    assert.equal(pending.events.includes(action), false);
  }
});

test("New cancels delayed record permission and offline export completion", async () => {
  const rendering = deferred(), connection = deferred();
  const run = componentHarness({ rendering });
  run.engine.hasInput = false;
  run.values.studio.connect = () => connection.promise;
  const recording = run.record();
  const exporting = run.exportMix();
  await flush();
  await run.newProject();
  run.engine.hasInput = true;
  connection.resolve();
  rendering.resolve(buffer);
  await Promise.all([recording, exporting]);
  assert.equal(run.events.includes("record"), false);
  assert.equal(run.events.includes("download"), false);
  run.unmount();
});

test("play and record wait for a running audio clock and honor cancellation during resume", async () => {
  for (const action of ["play", "record"]) {
    const resume = deferred();
    const run = componentHarness({ resume });
    const pending = run[action]();
    await flush();
    assert.equal(run.events.includes(action), false, "transport must not pretend to run while audio is paused");
    await run.newProject();
    resume.resolve();
    await pending;
    assert.equal(run.events.includes(action), false, "late resume must not restart a discarded transport request");
    run.unmount();
  }
});

test("recording reads the current input compensation after audio resume", async () => {
  const resume = deferred(), latency = { value: 69 };
  const run = componentHarness({ resume, latency });
  let recordedLatency;
  run.engine.record = (_from, _project, _buffers, _options, value) => { recordedLatency = value; };
  const pending = run.record();
  await flush();
  latency.value = null; // A newly selected, uncalibrated input uses automatic compensation.
  resume.resolve();
  await pending;
  assert.equal(recordedLatency, 0);
  run.unmount();
});

test("recording uses the newly connected input's calibration before a UI rerender", async () => {
  const saved = new Map([["microphone", 69], ["Spark", 12]]);
  const run = componentHarness({ getLatencyMs: id => saved.get(id) ?? null });
  let attached = "microphone", recordedLatency;
  run.engine.hasInput = false;
  run.values.studio.deviceId = "microphone"; // The old rendered selection.
  run.values.studio.getConnectedDeviceId = () => attached;
  run.values.studio.connect = async () => { attached = "Spark"; run.engine.hasInput = true; };
  run.engine.record = (_from, _project, _buffers, _options, value) => { recordedLatency = value; };
  await run.record();
  assert.equal(recordedLatency, 0.012);
  run.unmount();
});

test("already-started audio saves are queued before the project deletion transaction", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const path = require.resolve("../src/lib/studio/storage");
  const queued = [], transactions = [];
  const database = { transaction(stores) {
    const tx = { objectStore(name) { return {
      put() { queued.push(`${name}:put`); }, clear() { queued.push(`${name}:clear`); },
    }; } };
    transactions.push({ stores, tx });
    return tx;
  } };
  const opening = { result: database };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open: () => opening } });
  delete require.cache[path];
  t.after(() => { if (original) Object.defineProperty(globalThis, "indexedDB", original); else delete globalThis.indexedDB; delete require.cache[path]; });
  const storage = require(path);
  const saving = storage.saveBuffer({ id: "synthetic", sampleRate: 48000, channels: [new Float32Array(1)] });
  const clearing = storage.clearStudio();
  opening.onsuccess();
  await flush();
  assert.deepEqual(queued, ["buffers:put", "project:clear", "buffers:clear"]);
  assert.deepEqual(transactions[1].stores, ["project", "buffers"]);
  transactions.forEach(({ tx }) => tx.oncomplete());
  await Promise.all([saving, clearing]);
});

test("an ordinary current import still registers, stores and inserts its audio", async () => {
  const run = componentHarness();
  const importing = run.importFile(file);
  await flush();
  run.decoding.resolve(buffer);
  await importing;
  assert.equal(run.stored.length, 1);
  assert.equal(run.events.includes("register"), true);
  assert.deepEqual(run.actions.map(action => action.type), ["edit"]);
  run.unmount();
});
