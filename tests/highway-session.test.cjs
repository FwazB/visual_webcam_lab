/* eslint-disable @typescript-eslint/no-require-imports -- Execute the real hook with controlled audio lifetimes. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function setup() {
  const states = [], refs = [], memos = [], effects = [], frames = new Map(), events = new Map();
  let si = 0, ri = 0, mi = 0, ei = 0, dirty = false, mounted = true, nextFrame = 1, pending = [], value, noteListener;
  const judged = [], advanced = [], signals = [], feedback = [], starts = [];
  let resets = 0, stops = 0;
  const context = { state: 'running', currentTime: 5 };
  const pitch = { status: 'running', context, test: { setEnabled(v) { signals.push(v); } }, onNote(fn) { noteListener = fn; return () => { noteListener = null; }; } };
  const transport = { playing: false, bpm: 80, beatsRef: { current: 0 }, beatsAt: t => t - 5,
    async start(options) { starts.push(options); transport.playing = true; }, stop() { stops++; transport.playing = false; } };
  const input = { enabled: true };
  const document = { hidden: false, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } };
  const same = (a, b) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { return refs[ri++] ??= { current: initial }; },
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], v => { const next = typeof v === 'function' ? v(states[i]) : v; if (!Object.is(next, states[i])) { states[i] = next; dirty = true; } }]; },
    useMemo(fn, deps) { const i = mi++; if (!memos[i] || !same(deps, memos[i].deps)) memos[i] = { value: fn(), deps }; return memos[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = ei++; if (!effects[i] || !deps || !same(deps, effects[i].deps)) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  class Game { reset() { resets++; } onNote(...args) { judged.push(args); return { kind: 'good' }; } advance(...args) { advanced.push(args); } }
  const source = fs.readFileSync(require.resolve('../src/hooks/useHighwaySession.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function('require','module','exports','document','requestAnimationFrame','cancelAnimationFrame',compiled)(name => {
    if (name === 'react') return react;
    if (name === '@/lib/lesson/noteHighway') return { createHighwayPattern: () => ({}), HighwayGame: Game };
    throw new Error(name);
  }, loaded, loaded.exports, document, fn => { const id = nextFrame++; frames.set(id, fn); return id; }, id => frames.delete(id));
  const profile = {};
  function render() { if (!mounted) return; si = ri = mi = ei = 0; dirty = false; pending = []; value = loaded.exports.useHighwaySession(profile, pitch, transport, input.enabled, (...args) => feedback.push(args)); pending.forEach(fn => fn()); }
  render();
  return { pitch, transport, input, document, context, judged, advanced, signals, feedback, starts,
    get value() { return value; }, get stops() { return stops; }, get resets() { return resets; },
    render, async flush() { await new Promise(setImmediate); render(); await new Promise(setImmediate); if (dirty) render(); },
    note(t = 6) { noteListener?.({ id: 1, t, midi: 40, midiFloat: 40, strength: .8 }); },
    frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); if (dirty) render(); },
    hide() { document.hidden = true; events.get('visibilitychange')?.(); },
    cleanup() { mounted = false; effects.forEach(e => e.cleanup?.()); },
  };
}

test('preview moves the transport but cannot judge notes or accumulate misses', async () => {
  const run = setup(); await run.value.start(true); await run.flush();
  run.note(); run.frame();
  assert.equal(run.transport.playing, true); assert.equal(run.value.preview, true);
  assert.deepEqual(run.starts, [{ silent: true }]);
  assert.equal(run.judged.length, 0); assert.equal(run.advanced.length, 0);
  assert.equal(run.signals.at(-1), false);
  run.value.stop(); assert.equal(run.signals.at(-1), true); run.cleanup();
});

test('scoring uses the shared onset clock and rejects pre-run or foreign-context events', async () => {
  const run = setup(); await run.value.start(); await run.flush();
  assert.deepEqual(run.starts, [{ silent: false }]);
  run.note(4.9); assert.equal(run.judged.length, 0);
  run.note(6); assert.equal(run.judged.length, 1); assert.equal(run.judged[0][1], 1);
  run.frame(); assert.equal(run.advanced.length, 1); assert.deepEqual(run.feedback, [[true, .8]]);
  run.pitch.context = { state: 'running', currentTime: 10 }; run.render(); run.note(11);
  assert.equal(run.judged.length, 1); assert.equal(run.transport.playing, false); run.cleanup();
});

test('loss of input stops scored play while preview works without an input', async () => {
  const run = setup(); await run.value.start(); await run.flush();
  run.pitch.status = 'unavailable'; run.render(); run.note();
  assert.equal(run.transport.playing, false); assert.equal(run.judged.length, 0);
  await run.value.start(); await run.flush(); assert.match(run.value.error, /Connect your guitar/);
  await run.value.start(true); await run.flush(); assert.equal(run.transport.playing, true);
  run.cleanup();
});

test('hiding or leaving play cancels pending starts without reviving a scored run', async () => {
  for (const invalidate of [run => run.hide(), run => { run.input.enabled = false; run.render(); }]) {
    const run = setup(); let finish;
    run.transport.start = () => new Promise(resolve => { finish = resolve; });
    const started = run.value.start(); run.render(); invalidate(run); finish(); await started; await run.flush();
    run.note(); assert.equal(run.judged.length, 0); assert.equal(run.value.starting, false);
    assert.equal(run.signals.at(-1), true); run.cleanup();
  }
});

test('input change during an asynchronous start and late completion after unmount are discarded', async () => {
  for (const unmount of [false, true]) {
    const run = setup(); let finish;
    run.transport.start = () => new Promise(resolve => { finish = resolve; });
    const started = run.value.start();
    if (unmount) run.cleanup(); else { run.pitch.context = { state: 'running', currentTime: 9 }; run.render(); }
    finish(); await started; await run.flush(); run.note();
    assert.equal(run.judged.length, 0); assert.equal(run.signals.at(-1), true);
    if (!unmount) run.cleanup();
  }
});

test('inactive play mode does not stop the existing song practice transport', async () => {
  const run = setup(); run.input.enabled = false; run.render();
  await run.transport.start(); run.render();
  assert.equal(run.transport.playing, true);
  run.hide(); assert.equal(run.transport.playing, true);
  run.note(); assert.equal(run.judged.length, 0); run.cleanup();
});
