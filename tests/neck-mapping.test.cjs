/* eslint-disable @typescript-eslint/no-require-imports -- Uses the shared Node TypeScript test bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { GUITAR_STANDARD, BASS_STANDARD } = require("../src/lib/instrument/profile");
const {
  createNeckCalibration, imageToNeck, neckToImage, fretCoordinate, positionOnNeck, locateFingers,
} = require("../src/lib/instrument/neckMapping");

const unitCorners = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => { assert.ok(actual); near(actual.x, expected.x); near(actual.y, expected.y); };
const project = ({ x, y }) => ({
  x: (0.12 + 0.62 * x + 0.08 * y) / (1 + 0.25 * x + 0.1 * y),
  y: (0.18 + 0.12 * x + 0.16 * y) / (1 + 0.25 * x + 0.1 * y),
});
function hand(tips) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: -1, y: -1 }));
  for (const [index, point] of Object.entries(tips)) landmarks[Number(index)] = point;
  return { landmarks };
}

test("perspective and horizontally mirrored necks round-trip known physical points", () => {
  for (const mirror of [false, true]) {
    const sensor = (point) => { const p = project(point); return mirror ? { x: 1 - p.x, y: p.y } : p; };
    const cal = createNeckCalibration(unitCorners.map(sensor), 2, 12, GUITAR_STANDARD);
    for (const neck of [...unitCorners, { x: 0.24, y: 0.2 }, { x: 0.73, y: 0.8 }, { x: 0.5, y: 0.5 }]) {
      nearPoint(imageToNeck(cal, sensor(neck)), neck);
      nearPoint(neckToImage(cal, neck), sensor(neck));
    }
    assert.equal(imageToNeck(cal, { x: 0.95, y: 0.95 }), null);
  }
});

test("diagonal perspective remains invertible when the inverse has no constant denominator", () => {
  const diagonal = ({ x, y }) => ({
    x: (0.15 + 0.2 * x + 0.1 * y) / (1 + 0.3 * x - 0.2 * y),
    y: (0.1 + 0.4 * x + 0.2 * y) / (1 + 0.3 * x - 0.2 * y),
  });
  const cal = createNeckCalibration(unitCorners.map(diagonal), 0, 12, GUITAR_STANDARD);
  for (const neck of [...unitCorners, { x: 0.37, y: 0.8 }]) {
    nearPoint(imageToNeck(cal, diagonal(neck)), neck);
    nearPoint(neckToImage(cal, neck), diagonal(neck));
  }
});

test("fret spacing contracts by the equal-temperament ratio and targets sit behind wires", () => {
  const cal = createNeckCalibration(unitCorners.map(project), 0, 12, GUITAR_STANDARD);
  near(fretCoordinate(cal, 0), 0);
  near(fretCoordinate(cal, 12), 1);
  for (let fret = 2; fret <= 12; fret++) {
    const previous = fretCoordinate(cal, fret - 1) - fretCoordinate(cal, fret - 2);
    const current = fretCoordinate(cal, fret) - fretCoordinate(cal, fret - 1);
    near(current / previous, 2 ** (-1 / 12));
  }
  const target = imageToNeck(cal, positionOnNeck(cal, GUITAR_STANDARD, 2, 5));
  near(target.x, fretCoordinate(cal, 4) + 0.75 * (fretCoordinate(cal, 5) - fretCoordinate(cal, 4)));
  near(target.y, 2 / 5);
  nearPoint(positionOnNeck(cal, GUITAR_STANDARD, 0, 0), project({ x: 0, y: 0 }));
  assert.ok(Number.isNaN(fretCoordinate(cal, 13)));
  assert.ok(Number.isNaN(fretCoordinate(cal, 2.5)));
});

test("guitar and bass map all their strings and preserve fingertip identity", () => {
  for (const profile of [GUITAR_STANDARD, BASS_STANDARD]) {
    const cal = createNeckCalibration(unitCorners.map(project), 0, 12, profile);
    for (let string = 0; string < profile.stringCount; string++) {
      for (const [index, finger] of [[8, 1], [12, 2], [16, 3], [20, 4]]) {
        const point = positionOnNeck(cal, profile, string, 3);
        const actual = locateFingers(cal, profile, [hand({}), hand({ [index]: point })]);
        assert.equal(actual.length, 1);
        assert.deepEqual(actual[0], { handIndex: 1, finger, string, fret: 3, midi: profile.tuning[string] + 3, point });
      }
    }
  }
});

test("same-note fingers on different strings remain separate visual candidates", () => {
  const cal = createNeckCalibration(unitCorners.map(project), 0, 12, GUITAR_STANDARD);
  const candidates = locateFingers(cal, GUITAR_STANDARD, [hand({
    8: positionOnNeck(cal, GUITAR_STANDARD, 0, 7),
    12: positionOnNeck(cal, GUITAR_STANDARD, 1, 2),
  })]);
  assert.deepEqual(candidates.map(({ finger, string, fret, midi }) => ({ finger, string, fret, midi })), [
    { finger: 1, string: 0, fret: 7, midi: 47 },
    { finger: 2, string: 1, fret: 2, midi: 47 },
  ]);
});

test("string and internal fret-wire boundaries retain every neighboring possibility", () => {
  const cal = createNeckCalibration(unitCorners, 0, 12, GUITAR_STANDARD);
  const candidates = locateFingers(cal, GUITAR_STANDARD, [hand({ 8: {
    x: fretCoordinate(cal, 5), y: 1.5 / 5,
  } })]);
  assert.deepEqual(candidates.map(({ string, fret }) => [string, fret]), [[1, 5], [1, 6], [2, 5], [2, 6]]);
  const finalWire = locateFingers(cal, GUITAR_STANDARD, [hand({ 8: { x: 1, y: 1 } })]);
  assert.deepEqual(finalWire.map(({ string, fret }) => [string, fret]), [[5, 12]]);
});

test("hidden or invalid fingertips never produce an open string or a guessed target", () => {
  const cal = createNeckCalibration(unitCorners.map(project), 0, 12, BASS_STANDARD);
  assert.deepEqual(locateFingers(cal, BASS_STANDARD, []), []);
  assert.deepEqual(locateFingers(cal, BASS_STANDARD, [{ landmarks: [] }]), []);
  assert.deepEqual(locateFingers(cal, BASS_STANDARD, [hand({
    8: { x: NaN, y: 0.3 }, 12: { x: 0.3, y: Infinity },
    16: { x: 0.95, y: 0.95 }, 20: { ...project({ x: 0.3, y: 0.3 }), z: NaN },
  })]), []);
  const nut = locateFingers(cal, BASS_STANDARD, [hand({ 8: project({ x: 0, y: 0 }) })]);
  assert.ok(nut.every((candidate) => candidate.fret > 0));
  assert.equal(imageToNeck(cal, { x: -0.001, y: 0.5 }), null);
  assert.equal(neckToImage(cal, { x: 1.001, y: 0.5 }), null);
  assert.equal(neckToImage(cal, { x: 0.5, y: NaN }), null);
});

test("calibration rejects crossed, concave, collapsed and off-image corners and invalid ranges", () => {
  const invalid = [
    [], [...unitCorners, { x: 0.5, y: 0.5 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
    [unitCorners[0], unitCorners[1], unitCorners[3], unitCorners[2]],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0.2, y: 0.2 }],
    unitCorners.map(({ x }) => ({ x, y: 0 })),
    unitCorners.map(({ x, y }) => ({ x, y: y * 1e-8 })),
    [{ x: -0.01, y: 0 }, ...unitCorners.slice(1)],
    [{ x: NaN, y: 0 }, ...unitCorners.slice(1)],
    [{ x: 0, y: Infinity }, ...unitCorners.slice(1)],
  ];
  for (const points of invalid) assert.throws(() => createNeckCalibration(points, 0, 12, GUITAR_STANDARD));
  for (const [first, last] of [[-1, 12], [3, 3], [12, 3], [0, 23], [0.5, 12], [0, NaN]]) {
    assert.throws(() => createNeckCalibration(unitCorners, first, last, GUITAR_STANDARD));
  }
});

test("partial-neck targets and instrument changes cannot reuse invalid geometry", () => {
  const points = unitCorners.map(project);
  const cal = createNeckCalibration(points, 3, 8, GUITAR_STANDARD);
  points[0].x = 1;
  nearPoint(cal.points[0], project(unitCorners[0]));
  assert.equal(positionOnNeck(cal, GUITAR_STANDARD, 0, 0), null);
  assert.equal(positionOnNeck(cal, GUITAR_STANDARD, 0, 3), null);
  assert.equal(positionOnNeck(cal, GUITAR_STANDARD, 0, 9), null);
  assert.equal(positionOnNeck(cal, GUITAR_STANDARD, 6, 5), null);
  assert.equal(positionOnNeck(cal, BASS_STANDARD, 0, 5), null);
  const point = positionOnNeck(cal, GUITAR_STANDARD, 0, 5);
  assert.deepEqual(locateFingers(cal, BASS_STANDARD, [hand({ 8: point })]), []);
  assert.deepEqual(locateFingers(cal, { ...GUITAR_STANDARD, tuning: [38, 45, 50, 55, 59, 64] }, [hand({ 8: point })]), []);
  assert.throws(() => createNeckCalibration(unitCorners, 0, 12, { ...GUITAR_STANDARD, tuning: [] }));
});
