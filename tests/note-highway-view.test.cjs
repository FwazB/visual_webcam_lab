/* eslint-disable @typescript-eslint/no-require-imports -- Exercises the client view without camera, audio, or a browser. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { GUITAR_STANDARD, BASS_STANDARD } = require("../src/lib/instrument/profile");

const compiled = ts.transpileModule(fs.readFileSync(require.resolve("../src/components/NoteHighway.tsx"), "utf8"), {
  fileName: "NoteHighway.tsx", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const children = node => Array.isArray(node) ? node.flatMap(children) : node && typeof node === "object"
  ? [node, ...children(node.props?.children)] : [];
const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object"
  ? text(node.props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";

function setup({ profile = GUITAR_STANDARD, playing = false, preview = false, reduced = false, beat = 0 } = {}) {
  const states = [], refs = [], effects = [], frames = new Map(), motionListeners = new Set();
  let stateIndex = 0, refIndex = 0, effectIndex = 0, nextFrame = 1, tree, dirty = false, pendingEffects = [];
  let renders = 0, updateCalls = 0, maxShadow = 0;
  const labels = [], lines = [], arcs = [], requests = [];
  let path = [];
  const context = {
    setTransform() {},
    clearRect() { labels.length = 0; lines.length = 0; arcs.length = 0; maxShadow = 0; },
    beginPath() { path = []; }, closePath() {},
    moveTo(x, y) { path.push({ x, y }); }, lineTo(x, y) { path.push({ x, y }); },
    quadraticCurveTo() {}, fill() {},
    stroke() { if (path.length === 2) lines.push({ path: [...path], color: this.strokeStyle }); },
    fillText(value, x, y) { labels.push({ text: value, x, y }); },
    arc(x, y, radius) { arcs.push({ x, y, radius }); },
    set shadowBlur(value) { maxShadow = Math.max(maxShadow, value); },
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  const surface = { clientWidth: 320, clientHeight: 360 };
  const motion = { matches: reduced, addEventListener: (_, listener) => motionListeners.add(listener),
    removeEventListener: (_, listener) => motionListeners.delete(listener) };
  const notes = [
    { id: "a", beat: 2, string: 0, fret: 3, midi: 43, state: "pending" },
    { id: "b", beat: 4, string: 2, fret: 2, midi: 52, state: "pending" },
  ];
  const summary = { score: 0, hits: 0, misses: 0, wrong: 0, streak: 0, bestStreak: 0, accuracy: 0, feedback: null };
  const game = {
    notesBetween(start, end) { requests.push({ start, end }); return notes.filter(note => note.beat >= start && note.beat <= end).map(note => ({ ...note })); },
    summary: () => ({ ...summary }),
    advance() { throw new Error("view must not advance scoring"); },
    onNote() { throw new Error("view must not synthesize hits"); },
  };
  const props = { profile, gameRef: { current: game }, beatsRef: { current: beat }, playing, inputReady: true, preview };
  const react = {
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => {
        updateCalls++;
        const value = typeof next === "function" ? next(states[index]) : next;
        if (!Object.is(value, states[index])) { states[index] = value; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const index = effectIndex++, previous = effects[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) pendingEffects.push(() => {
        previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "window", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", compiled)(
    name => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx, Fragment: "fragment" }
      : name.endsWith(".module.css") ? { default: new Proxy({}, { get: (_, key) => key }) } : require(name),
    loaded, loaded.exports, { devicePixelRatio: 3, matchMedia: () => motion },
    callback => { const id = nextFrame++; frames.set(id, callback); return id; }, id => frames.delete(id),
    () => ({ fontFamily: "Geist, sans-serif" }),
  );
  function render() {
    stateIndex = refIndex = effectIndex = 0; pendingEffects = []; dirty = false; renders++;
    tree = loaded.exports.default(props);
    for (const node of children(tree)) if (node.props?.ref) node.props.ref.current = node.type === "canvas" ? canvas : surface;
    pendingEffects.forEach(effect => effect());
  }
  render();
  return { props, notes, summary, game, labels, lines, arcs, requests, canvas, frames, motionListeners,
    get text() { return text(tree); }, get tree() { return tree; }, get updates() { return updateCalls; },
    get renders() { return renders; }, get glow() { return maxShadow; },
    render,
    frame(now) { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); if (dirty) render(); },
    reduceMotion(value) { motion.matches = value; motionListeners.forEach(listener => listener()); },
    cleanup() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}

for (const profile of [GUITAR_STANDARD, BASS_STANDARD]) {
  test(`${profile.stringCount} string lanes include matching visible labels and accessible upcoming fret instructions at 320px`, () => {
    const view = setup({ profile });
    view.frame(0);
    const labels = children(view.tree).filter(node => node.props?.["aria-label"]?.startsWith("String "));
    assert.equal(labels.length, profile.stringCount);
    assert.deepEqual(labels.map(node => text(node).slice(0, 1)), profile.stringLabels);
    assert.match(view.text, /Next: fret 3 on the (low )?E string/);
    assert.match(view.text, /Numbers are frets\. Lanes are strings\. 0 = open/);
    assert.equal(view.lines.filter(line => /^#[a-f0-9]{6}$/i.test(line.color) && line.color !== "#f1ede4").length, profile.stringCount);
    assert.ok(view.labels.some(label => label.text === "3"));
    assert.equal(view.canvas.width, 640, "DPR is capped at two to bound rendering memory");
    view.cleanup();
  });
}

test("idle chart is motionless; playback follows only the external audio beat clock", () => {
  const view = setup();
  view.frame(0);
  const initial = structuredClone(view.labels);
  view.props.beatsRef.current = 1;
  view.frame(500);
  assert.deepEqual(view.labels, initial, "wall time and an idle external clock cannot animate the chart");
  assert.equal(view.requests.at(-1).end, 6);
  view.props.playing = true;
  view.render();
  view.frame(600);
  assert.ok(view.labels.find(label => label.text === "3").y > initial.find(label => label.text === "3").y);
  assert.equal(view.requests.at(-1).end, 7);
  view.cleanup();
});

test("replacing a session resets the idle beat even when a prop restarts the drawing effect", () => {
  const view = setup({ beat: 2 });
  view.frame(0);
  assert.equal(view.requests.at(-1).end, 8);
  view.props.gameRef.current = { ...view.game };
  view.props.beatsRef.current = 0;
  view.props.preview = true;
  view.render();
  view.frame(150);
  assert.equal(view.requests.at(-1).end, 6);
  view.cleanup();
});

test("preview never presents scored hits or feedback even if a previous game has results", () => {
  const view = setup({ preview: true, playing: true, beat: 2 });
  Object.assign(view.summary, { score: 420, hits: 4, streak: 4, accuracy: 80, feedback: { kind: "perfect", beat: 2, noteId: "a" } });
  view.notes[0].state = "perfect";
  view.frame(0);
  assert.match(view.text, /Silent preview · scoring off/);
  assert.doesNotMatch(view.text, /420|80%|Perfect!/);
  assert.ok(view.labels.some(label => label.text === "3"), "preview retains the chart without claiming a hit");
  assert.equal(view.arcs.length, 0);
  assert.equal(view.glow, 0);
  view.cleanup();
});

test("count-in and live score come from the supplied game; DOM status updates at most eight times per second", () => {
  const view = setup({ playing: true, beat: -4 });
  view.frame(0);
  assert.match(view.text, /Get ready4/);
  for (let i = 1; i <= 30; i++) view.frame(i * 1000 / 30);
  assert.ok(view.updates <= 9);
  view.props.beatsRef.current = 2;
  Object.assign(view.summary, { score: 160, hits: 2, streak: 2, accuracy: 100, feedback: { kind: "good", beat: 2, noteId: "a" } });
  view.notes[0].state = "good";
  view.frame(1200);
  assert.match(view.text, /160/);
  assert.match(view.text, /100%/);
  assert.match(view.text, /Good timing/);
  assert.ok(!view.labels.some(label => label.text === "3"), "a scored note disappears without the view judging it");
  view.cleanup();
});

test("reduced motion removes feedback glow and pulse but preserves functional note travel", () => {
  const view = setup({ playing: true, beat: 2 });
  view.summary.feedback = { kind: "perfect", beat: 2, noteId: "a" };
  view.notes[0].state = "perfect";
  view.frame(0);
  assert.ok(view.arcs.length > 0);
  assert.ok(view.glow > 0);
  const previousY = view.labels.find(label => label.text === "2").y;
  view.reduceMotion(true);
  view.props.beatsRef.current = 2.2;
  view.frame(150);
  assert.equal(view.arcs.length, 0);
  assert.equal(view.glow, 0);
  assert.ok(view.labels.find(label => label.text === "2").y > previousY);
  view.cleanup();
  assert.equal(view.frames.size, 0);
  assert.equal(view.motionListeners.size, 0);
});
