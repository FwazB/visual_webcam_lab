/* eslint-disable @typescript-eslint/no-require-imports -- Exercise synthetic audio cancellation without devices. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createTestSignal } = require("../src/lib/audio/testSignal");

function setup({ failShaper = false } = {}) {
  const nodes = [], oscillators = [];
  const node = () => {
    const value = { connections: [], disconnected: 0,
      connect(target) { this.connections.push(target); return target; },
      disconnect() { this.disconnected++; this.connections = []; },
    };
    nodes.push(value);
    return value;
  };
  const ctx = { currentTime: 12, state: "running", destination: {},
    createOscillator() {
      const osc = Object.assign(node(), { frequency: { value: 0 }, onended: null, starts: [], stops: [],
        start(at) { this.starts.push(at); }, stop(at) { this.stops.push(at); },
      });
      oscillators.push(osc);
      return osc;
    },
    createWaveShaper() { if (failShaper) throw new Error("Graph unavailable"); return node(); },
    createGain() { return Object.assign(node(), { gain: { value: 0,
      setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
    } }); },
  };
  const target = {};
  return { ctx, target, nodes, oscillators, signal: createTestSignal(ctx, target) };
}

test("disabling synthetic input immediately disconnects active and scheduled voices and blocks new plucks", () => {
  const run = setup();
  run.signal.playPluck(45);
  run.signal.playPluck(52, { monitor: true });
  assert.equal(run.oscillators.length, 2);
  assert.ok(run.nodes.some(node => node.connections.includes(run.target)));
  run.signal.setEnabled(false);
  assert.ok(run.nodes.every(node => node.disconnected === 1 && node.connections.length === 0));
  assert.ok(run.oscillators.every(osc => osc.stops.at(-1) === undefined && osc.onended === null));
  run.signal.playPluck(57);
  assert.equal(run.oscillators.length, 2, "a stale UI callback cannot inject another voice");
  run.signal.setEnabled(false);
  assert.ok(run.nodes.every(node => node.disconnected === 1));
});

test("cancelling a sleeping sweep resolves promptly and re-enabling cannot revive its old generation", { timeout: 1000 }, async () => {
  const run = setup();
  const pending = run.signal.sweep(40, 44, { noteMs: 10_000, gapMs: 500 });
  assert.equal(run.oscillators.length, 1);
  run.signal.setEnabled(false);
  run.signal.setEnabled(true);
  const played = await pending;
  assert.deepEqual(played.map(note => note.midi), [40]);
  assert.equal(run.oscillators.length, 1);
  run.signal.playPluck(45);
  assert.equal(run.oscillators.length, 2, "a new explicit test can run after play stops");
  run.signal.setEnabled(false);
  assert.deepEqual(await run.signal.sweep(40, 44), []);
  assert.equal(run.oscillators.length, 2);
});

test("finished or partially constructed voices release every owned audio node", () => {
  const run = setup();
  run.signal.playPluck(45, { monitor: true });
  run.oscillators[0].onended();
  assert.ok(run.nodes.every(node => node.disconnected === 1));
  run.signal.setEnabled(false);
  assert.ok(run.nodes.every(node => node.disconnected === 1));
  const failed = setup({ failShaper: true });
  assert.throws(() => failed.signal.playPluck(45), /Graph unavailable/);
  assert.equal(failed.oscillators[0].disconnected, 1);
  assert.equal(failed.oscillators[0].onended, null);
  failed.signal.setEnabled(false);
  assert.equal(failed.oscillators[0].disconnected, 1);
});

test("a closed audio context and invalid sweep bounds never create synthetic audio", async () => {
  const run = setup();
  for (const [from, to] of [[NaN, 45], [40, Infinity], [-1, 45], [40, 128]]) {
    assert.deepEqual(await run.signal.sweep(from, to), []);
  }
  run.ctx.state = "closed";
  run.signal.playPluck(45);
  assert.deepEqual(await run.signal.sweep(40, 44), []);
  assert.equal(run.nodes.length, 0);
});
