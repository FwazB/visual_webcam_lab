/* eslint-disable @typescript-eslint/no-require-imports -- Executes the real client component with controlled React and media primitives. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { GUITAR_STANDARD, BASS_STANDARD } = require("../src/lib/instrument/profile");

const compile = ts.transpileModule(fs.readFileSync(require.resolve("../src/components/RealFretboardOverlay.tsx"), "utf8"), {
  fileName: "RealFretboardOverlay.tsx",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (node === null || typeof node !== "object") return [];
  return [node, ...descendants(node.props?.children)];
}

function textOf(node) {
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? textOf(node.props?.children) : "";
}

function sourceWithTrack(track = { id: "camera-1", readyState: "live", enabled: true, muted: false }) {
  return { getVideoTracks: () => [track] };
}

function setup({ cameraAvailable = true, profile = GUITAR_STANDARD, fretCount = 11 } = {}) {
  const states = [], refs = [], effects = [];
  const scheduled = new Map();
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  let pendingEffects = [], dirty = false, mounted = true;
  let now = 0, nextFrame = 1, tree;
  const surface = { clientWidth: 1000, clientHeight: 600 };
  const markingButton = { focus() {} };
  const video = {
    videoWidth: cameraAvailable ? 2000 : 0,
    videoHeight: cameraAvailable ? 1000 : 0,
    readyState: cameraAvailable ? 2 : 0,
    paused: !cameraAvailable, ended: false, currentTime: 0,
    srcObject: cameraAvailable ? sourceWithTrack() : null,
  };
  const marks = [], lines = [], labels = [];
  let pathPoints = [], snapshotDraws = 0, seedCount = 0;
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, drawImage() { snapshotDraws++; },
    setTransform() {},
    clearRect() { marks.length = 0; lines.length = 0; labels.length = 0; snapshotDraws = 0; },
    measureText: (value) => ({ width: value.length * 7 }),
    beginPath() { pathPoints = []; }, moveTo(x, y) { pathPoints.push({ x, y }); }, lineTo(x, y) { pathPoints.push({ x, y }); },
    stroke() { if (pathPoints.length === 2) lines.push({ points: [...pathPoints], color: this.strokeStyle }); }, fill() {},
    strokeText() {}, fillText(value) { labels.push(value); },
    arc(x, y, radius) { marks.push({ x, y, radius, color: this.fillStyle }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const props = {
    profile,
    videoRef: { current: video },
    handsRef: { current: [] },
    handsUpdatedAtRef: { current: -Infinity },
    targetRef: { current: null },
    pitch: {
      frameRef: { current: null },
      context: { currentTime: 0, state: "running" },
      status: "running",
      tuning: { gateDb: -60, clarityThreshold: 0.85 },
    },
    ready: cameraAvailable, trackingLoading: false, trackingError: null,
  };
  let seedPoints = null;
  let automaticPose = true;
  const neck = {
    poseRef: { current: null }, snapshotRef: { current: null },
    status: "idle", error: null, proposal: null,
    freeze() {
      this.reset();
      this.snapshotRef.current = { canvas: {}, width: 1000, height: 500, rgba: new Uint8ClampedArray(), capturedAt: now, mediaTime: video.currentTime,
        camera: { video, source: video.srcObject, track: video.srcObject?.getVideoTracks()[0] ?? null, width: video.videoWidth, height: video.videoHeight } };
      return true;
    },
    find() {
      this.freeze();
      this.proposal = { points: [{ x: .2, y: .3 }, { x: .2, y: .7 }, { x: .8, y: .3 }, { x: .8, y: .7 }], wireCount: fretCount,
        frets: Array.from({ length: fretCount }, (_, i) => ({ a: { x: .2 + .6 * i / (fretCount - 1), y: .3 }, b: { x: .2 + .6 * i / (fretCount - 1), y: .7 } })) };
      this.status = "proposal";
    },
    seed(points) { seedCount++; seedPoints = points; this.snapshotRef.current = null; this.proposal = null; this.status = "searching"; },
    reset() { this.poseRef.current = null; this.snapshotRef.current = null; seedPoints = null; this.proposal = null; this.status = "idle"; },
    pause() { this.reset(); this.status = "paused"; },
    resume() { this.reset(); this.error = null; },
  };
  const react = {
    useRef(initial) { return refs[refIndex++] ??= { current: initial }; },
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = initial;
      return [states[i], (next) => {
        const value = typeof next === "function" ? next(states[i]) : next;
        if (!Object.is(value, states[i])) { states[i] = value; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || deps.some((dep, j) => !Object.is(dep, previous.deps[j]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[i] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, elementProps) => ({ type, props: elementProps });
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "requestAnimationFrame", "cancelAnimationFrame", "performance", "window", compile)(
    (name) => name === "react" ? react : name === "react/jsx-runtime" ? { jsx, jsxs: jsx, Fragment: "fragment" }
      : name === "@/hooks/useNeckTracking" ? { useNeckTracking: () => neck } : require(name),
    loaded, loaded.exports,
    (callback) => { const id = nextFrame++; scheduled.set(id, callback); return id; },
    (id) => scheduled.delete(id), { now: () => now }, { devicePixelRatio: 1 },
  );
  function render() {
    if (!mounted) return;
    stateIndex = refIndex = effectIndex = 0;
    dirty = false;
    pendingEffects = [];
    tree = loaded.exports.default(props);
    for (const element of descendants(tree)) {
      const ref = element.props?.ref;
      if (ref && typeof ref === "object") {
        ref.current = element.type === "canvas" ? canvas : element.type === "video" ? video : element.type === "button" ? markingButton : surface;
      }
    }
    pendingEffects.forEach((effect) => effect());
  }
  function flush() {
    for (let attempts = 0; dirty && attempts < 10; attempts++) render();
    assert.equal(dirty, false, "component effects settle without a render loop");
  }
  render();
  return {
    props, video, marks, lines, labels, neck,
    get snapshotDraws() { return snapshotDraws; },
    get seedCount() { return seedCount; },
    render,
    acquire() { neck.find(); render(); flush(); },
    get referencePoints() { return seedPoints; },
    trackPose(points, at) { automaticPose = false; neck.poseRef.current = points ? { points, capturedAt: at, mediaTime: video.currentTime } : null; },
    get tree() { return tree; },
    get text() { return textOf(tree); },
    readout(label) {
      const paragraph = descendants(tree).find((node) => node.type === "p" && textOf(node).startsWith(label));
      assert.ok(paragraph, `${label} readout exists`);
      return textOf(paragraph);
    },
    button(label) {
      return descendants(tree).find((node) => node.type === "button" && textOf(node) === label);
    },
    clickButton(label) {
      const button = this.button(label);
      assert.ok(button, `${label} button exists`);
      assert.ok(!button.props.disabled, `${label} is enabled`);
      button.props.onClick();
      render();
      flush();
    },
    frame(time, performanceTime = time) {
      now = performanceTime;
      if (automaticPose && seedPoints) {
        neck.poseRef.current = { points: seedPoints, capturedAt: now, mediaTime: video.currentTime };
        neck.status = "tracking";
      }
      props.pitch.context.currentTime = performanceTime / 1000;
      const callbacks = [...scheduled.values()];
      scheduled.clear();
      callbacks.forEach((callback) => callback(time));
      flush();
    },
    hear(midi, at) {
      props.pitch.frameRef.current = {
        t: at / 1000, hz: 440 * 2 ** ((midi - 69) / 12), midi, midiFloat: midi, cents: 0, clarity: 0.98, rms: 0.1, db: -20,
      };
    },
    cleanup() {
      mounted = false;
      effects.forEach((effect) => effect.cleanup?.());
      assert.equal(scheduled.size, 0, "unmount cancels the component's animation frame");
    },
  };
}

function showHand(run, observedAt, point = { x: 0.65, y: 0.4 }) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: .95, y: .95, z: 0 }));
  landmarks[8] = { ...point, z: 0 };
  run.props.handsRef.current = [{ landmarks, label: "Left", score: .99 }];
  run.props.handsUpdatedAtRef.current = observedAt;
}
function find(run) {
  assert.equal(run.button("Find fretboard"), undefined, "the camera does not require a Find click");
  run.acquire();
  assert.equal(run.seedCount, 1, "a valid proposal seeds tracking without numeric setup or confirmation");
  assert.ok(run.button("Pause neck tracking"));
}
const stringLines = run => run.lines.filter(line => line.color === "rgba(255,255,255,0.75)");
const fretLines = run => run.lines.filter(line => line.color === "rgba(250,204,21,0.8)");

test("the heard note remains independent without a decoded camera image", () => {
  const run = setup({ cameraAvailable: false });
  run.hear(45, 90);
  run.frame(100);
  assert.equal(run.readout("Heard"), "Heard · A2");
  assert.match(run.readout("Seen"), /No fresh hands visible/);
  assert.equal(run.marks.length, 0);
  run.cleanup();
});

test("fresh mirrored hand landmarks appear before finding a fretboard", () => {
  const run = setup();
  showHand(run, 100);
  run.frame(100);
  assert.equal(run.marks.length, 21);
  const index = run.marks.find(mark => mark.radius === 4 && mark.x === 350);
  assert.ok(index, "sensor-right fingertip is rendered on the mirrored display's left");
  assert.equal(index.y, 250, "the camera letterbox is respected");
  assert.equal(index.color, "#c4b5fd");
  assert.deepEqual(run.labels, [], "finger names remain in the readout instead of overlapping the camera dots");
  assert.equal(stringLines(run).length, 0);
  assert.match(run.readout("Seen"), /Hand landmarks visible/);
  assert.equal(descendants(run.tree).filter(node => node.type === "input").length, 0);
  assert.equal(run.button("Mark manually"), undefined);
  assert.doesNotMatch(run.text, /wire 0|wire 7|first wire|last wire|0–7/i);
  run.cleanup();
});

for (const profile of [GUITAR_STANDARD, BASS_STANDARD]) {
  test(`${profile.stringCount} continuous strings and every observed fret are drawn without a default fret range`, () => {
    const run = setup({ profile, fretCount: 23 });
    find(run);
    run.frame(100);
    assert.equal(stringLines(run).length, profile.stringCount);
    assert.equal(fretLines(run).length, 23);
    assert.match(run.text, /23 observed fret lines/);
    assert.ok(run.text.includes(`${profile.stringCount}-string guide`));
    run.frame(150);
    assert.equal(run.seedCount, 1, "renders do not repeatedly seed the same proposal");
    run.cleanup();
  });
}

test("only observed irregular fret segments are reprojected with the tracked neck", () => {
  const run = setup();
  const originalFind = run.neck.find;
  run.neck.find = function () {
    originalFind.call(this);
    this.proposal.frets = [0, .15, .42, 1].map(t => ({ a: { x: .2 + .6 * t, y: .3 }, b: { x: .2 + .6 * t, y: .7 } }));
    this.proposal.wireCount = 4;
  };
  find(run);
  run.frame(100);
  assert.deepEqual(fretLines(run).map(line => Math.round(line.points[0].x)), [800, 710, 548, 200]);
  const shifted = run.referencePoints.map(point => ({ x: point.x + .05, y: point.y + .05 }));
  run.trackPose(shifted, 150);
  run.frame(150);
  assert.equal(fretLines(run).length, 4, "gaps between observed wires are never filled with invented frets");
  assert.deepEqual(fretLines(run).map(line => Math.round(line.points[0].x)), [750, 660, 498, 150]);
  run.cleanup();
});

test("on-neck fingertips remain observations independent of lesson targets and heard pitch", () => {
  const run = setup();
  find(run);
  showHand(run, 100);
  run.hear(45, 100);
  run.props.targetRef.current = { string: 1, fret: 2, midi: 47 };
  run.frame(100);
  assert.equal(run.readout("Seen"), "Seen · Index visible on neck");
  assert.equal(run.readout("Heard"), "Heard · A2");
  assert.equal(run.marks.filter(mark => mark.radius === 6).length, 1);
  assert.match(run.text, /string contact is not measured/);
  assert.match(run.text, /Target · B2/);
  assert.equal(run.marks.some(mark => mark.radius === 15), false, "no target ring is placed without absolute fret identity");
  run.props.targetRef.current = { string: 0, fret: 17, midi: 57 };
  run.hear(60, 150);
  showHand(run, 150);
  run.frame(150);
  assert.equal(run.readout("Seen"), "Seen · Index visible on neck");
  assert.equal(run.readout("Heard"), "Heard · C4");
  assert.doesNotMatch(run.text, /Pitch fits|agrees|Near E fret/);
  run.cleanup();
});

test("neck loss hides the grid while fresh raw hand landmarks remain visible, then reacquires", () => {
  const run = setup();
  find(run);
  const reference = run.referencePoints;
  showHand(run, 100);
  run.frame(100);
  assert.equal(run.marks.filter(mark => mark.radius === 6).length, 1);
  run.trackPose(null, 150);
  showHand(run, 150);
  run.frame(150);
  assert.equal(run.marks.length, 21);
  assert.equal(run.marks.filter(mark => mark.radius === 6).length, 0);
  assert.equal(stringLines(run).length, 0);
  assert.equal(fretLines(run).length, 0);
  assert.match(run.readout("Seen"), /Hand landmarks visible/);
  run.trackPose(reference, 200);
  showHand(run, 200);
  run.frame(200);
  assert.equal(stringLines(run).length, 6);
  assert.equal(run.marks.filter(mark => mark.radius === 6).length, 1);
  run.cleanup();
});

test("background detection never covers live video or interrupts live hand landmarks", () => {
  const run = setup();
  showHand(run, 100);
  run.frame(100);
  run.neck.find = function () { this.freeze(); this.status = "detecting"; };
  run.acquire();
  showHand(run, 150);
  run.frame(150);
  assert.equal(run.snapshotDraws, 0);
  assert.equal(run.marks.length, 21);
  assert.equal(stringLines(run).length, 0);
  run.clickButton("Pause neck tracking");
  showHand(run, 200);
  run.frame(200);
  assert.equal(run.marks.length, 21);
  assert.equal(run.snapshotDraws, 0);
  assert.ok(run.button("Resume neck tracking"));
  run.cleanup();
});

test("automatic reacquisition replaces the observed fret set without retaining the previous grid", () => {
  const run = setup({ fretCount: 11 });
  find(run);
  showHand(run, 100);
  run.frame(100);
  assert.equal(fretLines(run).length, 11);
  run.neck.freeze();
  run.neck.status = "detecting";
  run.render();
  showHand(run, 150);
  run.frame(150);
  assert.equal(fretLines(run).length, 0);
  assert.equal(run.marks.length, 21);
  assert.equal(run.snapshotDraws, 0);
  const detect = run.neck.find;
  run.neck.find = function () {
    detect.call(this);
    this.proposal.frets = this.proposal.frets.filter((_, i) => [0, 3, 7, 10].includes(i));
    this.proposal.wireCount = 4;
  };
  run.acquire();
  showHand(run, 200);
  run.frame(200);
  assert.equal(run.seedCount, 2);
  assert.equal(stringLines(run).length, 6);
  assert.equal(fretLines(run).length, 4);
  assert.equal(run.marks.length, 21);
  assert.equal(run.snapshotDraws, 0);
  run.cleanup();
});

test("a proposal arriving after a camera switch cannot seed the replacement camera", () => {
  const run = setup();
  const detect = run.neck.find;
  run.neck.find = function () { this.freeze(); this.status = "detecting"; };
  run.acquire();
  const oldSnapshot = run.neck.snapshotRef.current;
  run.video.srcObject = sourceWithTrack({ id: "replacement", readyState: "live", enabled: true, muted: false });
  detect.call(run.neck);
  run.neck.snapshotRef.current = oldSnapshot;
  run.render();
  run.frame(100);
  assert.equal(run.seedCount, 0);
  assert.equal(stringLines(run).length, 0);
  assert.match(run.text, /camera changed or stopped/i);
  assert.ok(run.button("Pause neck tracking"));
  run.cleanup();
});

test("stale or unsynchronized observations never become current on-neck placements", () => {
  const run = setup();
  find(run);
  showHand(run, 100);
  run.frame(100);
  run.hear(45, 490);
  run.frame(150, 500);
  assert.equal(run.marks.length, 0, "wall-clock age wins over an older RAF timestamp");
  assert.equal(run.readout("Heard"), "Heard · A2");
  showHand(run, 500);
  run.trackPose(run.referencePoints, 350);
  run.frame(550);
  assert.equal(run.marks.length, 21);
  assert.equal(run.marks.filter(mark => mark.radius === 6).length, 0, "fresh but misaligned camera times are raw hands only");
  run.trackPose([{ x: .5, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .5 }, { x: .5, y: .5 }], 600);
  showHand(run, 600);
  run.frame(600);
  assert.equal(stringLines(run).length, 0, "invalid quadrilaterals never become a grid");
  assert.equal(run.marks.length, 21);
  run.cleanup();
});

for (const replacement of ["stream", "track", "paused", "dimensions"]) {
  test(`camera ${replacement} changes clear the grid and suppress previous-source hands`, () => {
    const run = setup();
    find(run);
    showHand(run, 100);
    run.frame(100);
    const track = { id: "camera-2", readyState: "live", enabled: true, muted: false };
    if (replacement === "stream") run.video.srcObject = sourceWithTrack(track);
    else if (replacement === "track") run.video.srcObject.getVideoTracks = () => [track];
    else if (replacement === "paused") run.video.paused = true;
    else run.video.videoWidth = 0;
    run.hear(45, 150);
    run.frame(150);
    assert.equal(run.marks.length, 0);
    assert.equal(stringLines(run).length, 0);
    assert.equal(run.readout("Heard"), "Heard · A2");
    assert.match(run.text, /Looking for|Waiting for/i);
    if (replacement === "stream" || replacement === "track") {
      showHand(run, 200);
      run.frame(200);
      assert.equal(run.marks.length, 21, "new-source landmarks can appear before another find");
      assert.equal(stringLines(run).length, 0);
    }
    run.cleanup();
  });
}

test("automatic detection has pause, resume and error retry controls without manual corner entry", () => {
  const run = setup();
  run.neck.find = function () { this.freeze(); this.error = null; this.status = "detecting"; };
  run.acquire();
  assert.match(run.text, /Looking for the fretboard automatically/);
  run.clickButton("Pause neck tracking");
  assert.ok(run.button("Resume neck tracking"));
  run.clickButton("Resume neck tracking");
  assert.ok(run.button("Pause neck tracking"));
  run.neck.status = "error";
  run.neck.error = "Tracking worker stopped.";
  run.render();
  assert.ok(!run.button("Retry neck tracking").props.disabled);
  run.clickButton("Retry neck tracking");
  assert.doesNotMatch(run.text, /Tracking worker stopped/);
  assert.ok(run.button("Pause neck tracking"));
  assert.equal(descendants(run.tree).filter(node => node.type === "input").length, 0);
  run.cleanup();
});

test("hand tracking retry is independent and appears only for a hand error", () => {
  const run = setup();
  let retries = 0;
  run.props.onRetryHandTracking = () => { retries++; };
  run.render();
  assert.equal(run.button("Retry hand tracking"), undefined);
  run.props.trackingError = "Hand model unavailable";
  run.render();
  run.clickButton("Retry hand tracking");
  assert.equal(retries, 1);
  assert.equal(run.neck.status, "idle");
  run.cleanup();
});
