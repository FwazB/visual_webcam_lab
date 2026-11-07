/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the actual storage module with isolated IndexedDB requests. */
const { test } = require("node:test");
const assert = require("node:assert/strict");

function storageHarness(t, { manualCompletion = false, failRequest } = {}) {
  const stores = { project: new Map(), buffers: new Map() }, transactions = [], calls = [];
  const database = { transaction(names, mode = "readonly") {
    const tx = { pending: 0, finished: false,
      complete() {
        if (!tx.pending && !tx.finished) { tx.finished = true; tx.oncomplete?.(); }
      },
      abort(error) {
        if (tx.finished) return;
        tx.finished = true;
        tx.error = error;
        tx.onabort?.();
      },
      objectStore(name) {
      assert.ok([names].flat().includes(name), "requests use a store in the same transaction");
      const request = (operation, key, fn) => {
        assert.equal(tx.finished, false);
        calls.push({ transaction: transactions.length - 1, name, operation, key });
        const req = {};
        tx.pending++;
        queueMicrotask(() => {
          tx.pending--;
          if (tx.finished) {
            req.error = tx.error;
            req.onerror?.();
            return;
          }
          const error = failRequest?.({ name, operation, key });
          if (error) {
            req.error = error;
            req.onerror?.();
            tx.error = error;
            tx.onerror?.();
            tx.abort(error);
            return;
          }
          req.result = structuredClone(fn());
          req.onsuccess?.();
          if (!manualCompletion) setImmediate(() => tx.complete());
        });
        return req;
      };
      const write = (operation, key, fn) => {
        assert.equal(mode, "readwrite", "restores cannot write or delete audio");
        return request(operation, key, fn);
      };
      return {
        get: key => request("get", key, () => stores[name].get(key)),
        getAll: () => request("getAll", undefined, () => [...stores[name].values()]),
        put: (value, key) => write("put", key ?? value.id, () => { stores[name].set(key ?? value.id, structuredClone(value)); }),
        delete: key => write("delete", key, () => { stores[name].delete(key); }),
        clear: () => write("clear", undefined, () => { stores[name].clear(); }),
      };
    } };
    transactions.push({ names: [names].flat(), mode, tx });
    return tx;
  } };
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() {
    const req = { result: database };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  } } });
  const path = require.resolve("../src/lib/studio/storage");
  delete require.cache[path];
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else delete globalThis.indexedDB;
    delete require.cache[path];
  });
  return { storage: require(path), stores, transactions, calls };
}

const empty = () => ({ bpm: 96, beatsPerBar: 4, tracks: [], clips: [] });
const buffer = id => ({ id, sampleRate: 48000, channels: [new Float32Array([0.2])] });

test("restore reads only referenced audio once in a single read-only project/buffer transaction", async t => {
  const run = storageHarness(t);
  const project = { ...empty(), clips: [{ bufferId: "used" }, { bufferId: "used" }] };
  run.stores.project.set("current", project);
  run.stores.buffers.set("used", buffer("used"));
  run.stores.buffers.set("unreferenced", buffer("unreferenced"));
  const saved = await run.storage.loadStudio();
  assert.deepEqual(saved.project, project);
  assert.deepEqual(saved.buffers.map(item => item.id), ["used"]);
  assert.equal(run.transactions.length, 1);
  assert.deepEqual(run.transactions[0].names, ["project", "buffers"]);
  assert.equal(run.transactions[0].mode, "readonly");
  assert.deepEqual(run.calls.map(call => [call.name, call.operation, call.key]), [
    ["project", "get", "current"], ["buffers", "get", "used"],
  ]);
  assert.equal(run.stores.buffers.has("unreferenced"), true);
});

test("another tab's restore cannot delete a take saved before its delayed project autosave", async t => {
  const run = storageHarness(t);
  await run.storage.saveProject(empty());
  await run.storage.saveBuffer(buffer("new-take"));
  const secondTab = await run.storage.loadStudio();
  assert.deepEqual(secondTab.buffers, []);
  assert.equal(run.stores.buffers.has("new-take"), true);
  await run.storage.saveProject({ ...empty(), clips: [{ bufferId: "new-take" }] });
  const restored = await run.storage.loadStudio();
  assert.deepEqual(restored.buffers.map(item => item.id), ["new-take"]);
  await run.storage.clearStudio();
  assert.equal(run.stores.project.size, 0);
  assert.equal(run.stores.buffers.size, 0, "explicit New still removes unreferenced audio too");
});

test("missing referenced buffers are omitted without deleting surviving audio", async t => {
  const run = storageHarness(t);
  const project = { ...empty(), clips: [{ bufferId: "missing" }, { bufferId: "present" }] };
  run.stores.project.set("current", project);
  run.stores.buffers.set("present", buffer("present"));
  const saved = await run.storage.loadStudio();
  assert.deepEqual(saved.project, project);
  assert.deepEqual(saved.buffers.map(item => item.id), ["present"]);
  assert.equal(run.stores.buffers.has("present"), true);
});

test("an empty project store does not load or delete unrelated audio", async t => {
  const run = storageHarness(t);
  run.stores.buffers.set("pending", buffer("pending"));
  assert.equal(await run.storage.loadStudio(), null);
  assert.equal(run.calls.length, 1);
  assert.equal(run.stores.buffers.has("pending"), true);
});

for (const failedStore of ["project", "buffers"]) {
  test(`restore rejects a ${failedStore} read error and its resulting transaction abort without returning partial audio`, async t => {
    const failure = new Error(`${failedStore} read failed`);
    const run = storageHarness(t, { failRequest: ({ name }) => name === failedStore ? failure : undefined });
    const project = { ...empty(), clips: [{ bufferId: "first" }, { bufferId: "second" }] };
    run.stores.project.set("current", project);
    for (const id of ["first", "second"]) run.stores.buffers.set(id, buffer(id));
    await assert.rejects(run.storage.loadStudio(), error => error === failure);
    // Drain sibling request rejections and any transaction events as well.
    // Node's test runner reports any unhandled rejection from either promise.
    await new Promise(setImmediate);
    assert.equal(run.transactions[0].tx.finished, true);
    assert.deepEqual(run.stores.project.get("current"), project);
    assert.deepEqual([...run.stores.buffers.keys()], ["first", "second"]);
  });
}

test("restore rejects a transaction abort even after every requested record was read successfully", async t => {
  const run = storageHarness(t, { manualCompletion: true });
  run.stores.project.set("current", { ...empty(), clips: [{ bufferId: "saved" }] });
  run.stores.buffers.set("saved", buffer("saved"));
  const failure = new Error("Storage transaction aborted");
  const pending = run.storage.loadStudio();
  const rejected = assert.rejects(pending, error => error === failure);
  await new Promise(setImmediate);
  const tx = run.transactions[0].tx;
  assert.equal(tx.pending, 0);
  assert.equal(tx.finished, false);
  tx.abort(failure);
  await rejected;
  tx.complete();
  assert.equal(run.stores.buffers.has("saved"), true);
});

for (const hasProject of [true, false]) {
  test(`restore waits for transaction completion after reading ${hasProject ? "the project and audio" : "an empty project store"}`, async t => {
    const run = storageHarness(t, { manualCompletion: true });
    if (hasProject) {
      run.stores.project.set("current", { ...empty(), clips: [{ bufferId: "saved" }] });
      run.stores.buffers.set("saved", buffer("saved"));
    }
    let settled = false;
    const pending = run.storage.loadStudio().then(saved => { settled = true; return saved; });
    await new Promise(setImmediate);
    const tx = run.transactions[0].tx;
    assert.equal(tx.pending, 0, "all data requests have succeeded");
    assert.equal(settled, false, "request success alone must not publish an uncommitted snapshot");
    tx.complete();
    const saved = await pending;
    assert.equal(settled, true);
    if (hasProject) assert.deepEqual(saved.buffers.map(item => item.id), ["saved"]);
    else assert.equal(saved, null);
  });
}
