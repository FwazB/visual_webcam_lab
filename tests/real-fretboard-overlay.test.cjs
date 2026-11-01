/* eslint-disable @typescript-eslint/no-require-imports -- Executes the real client component with controlled React and media primitives. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { GUITAR_STANDARD } = require("../src/lib/instrument/profile");

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

function setup({ cameraAvailable = true } = {}) {
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
  const marks = [];
  const ctx = {
    save() {}, restore() {}, translate() {}, scale() {}, drawImage() {},
    setTransform() {},
    clearRect() { marks.length = 0; },
    measureText: (value) => ({ width: value.length * 7 }),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, setLineDash() {}, strokeText() {}, fillText() {},
    arc(x, y, radius) { marks.push({ x, y, radius }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const props = {
    profile: GUITAR_STANDARD,
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
      this.snapshotRef.current = { canvas: {}, width: 1000, height: 500, rgba: new Uint8ClampedArray(), capturedAt: now, mediaTime: video.currentTime };
      return true;
    },
    find() {
      this.freeze();
      this.proposal = { points: [{ x: .2, y: .3 }, { x: .2, y: .7 }, { x: .8, y: .3 }, { x: .8, y: .7 }], wireCount: 8 };
      this.status = "proposal";
    },
    seed(points) { seedPoints = points; this.snapshotRef.current = null; this.proposal = null; this.status = "searching"; },
    reset() { this.poseRef.current = null; this.snapshotRef.current = null; seedPoints = null; this.proposal = null; this.status = "idle"; },
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
    props, video, marks, neck,
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
      flush();
    },
    clickImage(x, y) {
      const button = descendants(tree).find((node) => node.type === "button" && /^Mark point /.test(node.props["aria-label"] ?? ""));
      assert.ok(button, "calibration image accepts a point");
      button.props.onClick({ detail: 1, clientX: x, clientY: y, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600 }) } });
      flush();
    },
    frame(time, performanceTime = time) {
      now = performanceTime;
      if (automaticPose && seedPoints) neck.poseRef.current = { points: seedPoints, capturedAt: now, mediaTime: video.currentTime };
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

function calibrate(run) {
  run.clickButton("Mark manually");
  // 2000x1000 video contained in 1000x600: 50px letterbox vertically.
  // Mirrored display points correspond to sensor x=.2/.8 and y=.3/.7.
  for (const [x, y] of [[800, 200], [800, 400], [200, 200], [200, 400]]) run.clickImage(x, y);
  assert.ok(run.button("Set up again"), "four actual display clicks establish a tracked reference");
}

function showLowEFifthFret(run, observedAt) {
  // Independent physical fret spacing formula: halfway between wires 4 and 5,
  // normalized to the visible nut-to-wire-7 span, inside the calibrated rectangle.
  const along = ((1 - 2 ** (-4 / 12)) + (1 - 2 ** (-5 / 12))) / 2 / (1 - 2 ** (-7 / 12));
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.98, y: 0.98, z: 0 }));
  landmarks[8] = { x: 0.2 + 0.6 * along, y: 0.3, z: 0 };
  run.props.handsRef.current = [{ landmarks, label: "Left", score: 0.99 }];
  run.props.handsUpdatedAtRef.current = observedAt;
  run.hear(45, observedAt);
}

test("the heard note remains available when the camera has no decoded image", () => {
  const run = setup({ cameraAvailable: false });
  run.hear(45, 90);
  run.frame(100);
  assert.equal(run.readout("Heard"), "Heard · A2");
  assert.match(run.readout("Seen"), /Position uncertain/);
  run.cleanup();
});

test("mirrored calibration identifies the physical finger independently of lesson targets", () => {
  const run = setup();
  calibrate(run);
  showLowEFifthFret(run, 100);
  run.props.targetRef.current = { string: 1, fret: 2, midi: 47 };
  run.frame(100);
  assert.equal(run.readout("Seen"), "Seen · Near E fret 5");
  assert.match(run.text, /Pitch fits visible placement · contact unverified/);
  const fingerMark = run.marks.find((mark) => mark.radius === 6);
  assert.ok(fingerMark, "observed fingertip is drawn");
  assert.ok(fingerMark.x < 500, "sensor-right fingertip is drawn on the mirrored display's left");
  assert.equal(fingerMark.y, 200);

  run.props.targetRef.current = { string: 0, fret: 1, midi: 41 };
  run.frame(150);
  assert.equal(run.readout("Seen"), "Seen · Near E fret 5");
  assert.match(run.text, /Pitch fits visible placement · contact unverified/);
  run.props.handsRef.current = [];
  run.props.handsUpdatedAtRef.current = 190;
  run.frame(190);
  assert.match(run.readout("Seen"), /Position uncertain/);
  assert.doesNotMatch(run.text, /Pitch fits visible placement/);
  assert.equal(run.marks.filter((mark) => mark.radius === 6).length, 0, "target ring cannot become an observed finger");
  run.cleanup();
});

test("losing camera dimensions clears seen agreement while preserving fresh heard pitch", () => {
  const run = setup();
  calibrate(run);
  showLowEFifthFret(run, 100);
  run.frame(100);
  assert.match(run.text, /Pitch fits visible placement/);
  run.video.videoWidth = run.video.videoHeight = 0;
  run.video.readyState = 0;
  run.hear(45, 140);
  run.frame(150);
  assert.match(run.readout("Seen"), /Position uncertain/);
  assert.equal(run.readout("Heard"), "Heard · A2");
  assert.doesNotMatch(run.text, /Pitch fits visible placement/);
  assert.equal(run.marks.filter((mark) => mark.radius === 6).length, 0);
  run.cleanup();
});

test("freshness uses the current performance clock when RAF predates slow inference", () => {
  const run = setup();
  calibrate(run);
  showLowEFifthFret(run, 100);
  run.frame(100);
  assert.match(run.text, /Pitch fits visible placement/);
  run.hear(45, 490);
  run.frame(150, 500);
  assert.match(run.readout("Seen"), /Position uncertain/);
  assert.doesNotMatch(run.text, /Pitch fits visible placement/);
  assert.equal(run.readout("Heard"), "Heard · A2");
  run.cleanup();
});

for (const replacement of ["stream", "track"]) {
  test(`a same-size camera ${replacement} replacement invalidates calibration`, () => {
    const run = setup();
    calibrate(run);
    showLowEFifthFret(run, 100);
    run.frame(100);
    const newTrack = { id: "camera-2", readyState: "live", enabled: true, muted: false };
    if (replacement === "stream") run.video.srcObject = sourceWithTrack(newTrack);
    else run.video.srcObject.getVideoTracks = () => [newTrack];
    run.frame(150);
    assert.ok(run.button("Mark manually"), "replacement requires a new physical neck registration");
    assert.equal(run.button("Set up again"), undefined);
    assert.match(run.readout("Seen"), /Position uncertain/);
    assert.doesNotMatch(run.text, /Pitch fits visible placement/);
    assert.match(run.text, /camera.*changed/i);
    run.cleanup();
  });
}

test("tracking loss hides fingers and target rings, then reacquires without another calibration", () => {
  const run = setup();
  calibrate(run);
  const reference = run.referencePoints;
  showLowEFifthFret(run, 100);
  run.props.targetRef.current = { string: 0, fret: 5, midi: 45 };
  run.frame(100);
  assert.match(run.text, /Pitch fits visible placement/);
  run.trackPose(null, 150);
  showLowEFifthFret(run, 150);
  run.frame(150);
  assert.match(run.readout("Seen"), /Position uncertain/);
  assert.equal(run.marks.filter(mark => mark.radius === 6 || mark.radius === 15).length, 0);
  assert.ok(run.button("Set up again"), "reference survives temporary tracking loss");
  run.trackPose(reference, 200);
  showLowEFifthFret(run, 200);
  run.frame(200);
  assert.match(run.text, /Pitch fits visible placement/);
  run.cleanup();
});

test("the mapping follows a new neck pose and refuses unsynchronized hand coordinates", () => {
  const run = setup();
  calibrate(run);
  const moved = run.referencePoints.map(point => ({ x: point.x + .05, y: point.y + .08 }));
  run.trackPose(moved, 100);
  showLowEFifthFret(run, 100);
  const tip = run.props.handsRef.current[0].landmarks[8];
  tip.x += .05; tip.y += .08;
  run.frame(100);
  assert.equal(run.readout("Seen"), "Seen · Near E fret 5");
  assert.equal(run.marks.find(mark => mark.radius === 6).y, 240);
  run.props.handsUpdatedAtRef.current = 230;
  run.hear(45, 230);
  run.frame(240);
  assert.match(run.readout("Seen"), /Position uncertain/);
  assert.doesNotMatch(run.text, /Pitch fits visible placement/);
  run.cleanup();
});

test("automatic outline proposals wait for fret identity confirmation before tracking", () => {
  const run = setup();
  run.clickButton("Find fretboard");
  assert.ok(run.button("Use this outline"));
  assert.equal(run.referencePoints, null);
  run.clickButton("Use this outline");
  assert.equal(run.referencePoints.length, 4);
  showLowEFifthFret(run, 100);
  run.frame(100);
  assert.match(run.text, /Pitch fits visible placement/);
  run.cleanup();
});
