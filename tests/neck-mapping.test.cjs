/* eslint-disable @typescript-eslint/no-require-imports -- Uses the shared Node TypeScript test bootstrap. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createNeckGeometry, imageToNeck, neckToImage,
} = require("../src/lib/instrument/neckMapping");

const unitCorners = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => { assert.ok(actual); near(actual.x, expected.x); near(actual.y, expected.y); };
const project = ({ x, y }) => ({
  x: (0.12 + 0.62 * x + 0.08 * y) / (1 + 0.25 * x + 0.1 * y),
  y: (0.18 + 0.12 * x + 0.16 * y) / (1 + 0.25 * x + 0.1 * y),
});

test("unanchored geometry preserves every observed fret through mirrored perspective motion", () => {
  const original = createNeckGeometry(unitCorners.map(project));
  const movedPoint = ({ x, y }) => ({ x: 0.9 - 0.65 * x + 0.03 * y, y: 0.25 + 0.08 * x + 0.3 * y });
  const moved = createNeckGeometry(unitCorners.map(movedPoint));
  assert.equal("firstFret" in original, false);
  assert.equal("lastFret" in original, false);
  // A full visible 22-fret neck is not restricted to the former seven-fret span.
  const observed = Array.from({ length: 23 }, (_, fret) => {
    const x = (1 - 2 ** (-fret / 12)) / (1 - 2 ** (-22 / 12));
    return [project({ x, y: 0 }), project({ x, y: 1 })];
  });
  const transferred = observed.map(segment => segment.map(point => neckToImage(moved, imageToNeck(original, point))));
  assert.equal(transferred.length, 23);
  for (let fret = 0; fret < transferred.length; fret++) {
    const x = (1 - 2 ** (-fret / 12)) / (1 - 2 ** (-22 / 12));
    nearPoint(transferred[fret][0], movedPoint({ x, y: 0 }));
    nearPoint(transferred[fret][1], movedPoint({ x, y: 1 }));
  }
  assert.equal(imageToNeck(original, { x: 0.95, y: 0.95 }), null);
  assert.throws(() => createNeckGeometry([unitCorners[0], unitCorners[1], unitCorners[3], unitCorners[2]]));
});

test("perspective and horizontally mirrored necks round-trip known physical points", () => {
  for (const mirror of [false, true]) {
    const sensor = (point) => { const p = project(point); return mirror ? { x: 1 - p.x, y: p.y } : p; };
    const cal = createNeckGeometry(unitCorners.map(sensor));
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
  const cal = createNeckGeometry(unitCorners.map(diagonal));
  for (const neck of [...unitCorners, { x: 0.37, y: 0.8 }]) {
    nearPoint(imageToNeck(cal, diagonal(neck)), neck);
    nearPoint(neckToImage(cal, neck), diagonal(neck));
  }
});

test("geometry rejects crossed, concave, collapsed and off-image corners", () => {
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
  for (const points of invalid) assert.throws(() => createNeckGeometry(points));

});


test("invalid or off-neck observations never become a projected position", () => {
  const geometry = createNeckGeometry(unitCorners.map(project));
  for (const point of [{ x: -0.001, y: .5 }, { x: 1.001, y: .5 }, { x: .5, y: NaN }, { x: Infinity, y: .5 }]) {
    assert.equal(imageToNeck(geometry, point), null);
    assert.equal(neckToImage(geometry, point), null);
  }
  assert.equal(imageToNeck(geometry, { x: .95, y: .95 }), null);
});

test("geometry owns immutable corners and transforms independently of caller mutation", () => {
  const points = unitCorners.map(project);
  const geometry = createNeckGeometry(points);
  points[0].x = 1;
  nearPoint(geometry.points[0], project(unitCorners[0]));
  assert.ok(Object.isFrozen(geometry));
  assert.ok(Object.isFrozen(geometry.points));
  assert.ok(geometry.points.every(Object.isFrozen));
  assert.ok(Object.isFrozen(geometry.imageToNeckMatrix));
  assert.ok(Object.isFrozen(geometry.neckToImageMatrix));
  nearPoint(imageToNeck(geometry, project({ x: .4, y: .6 })), { x: .4, y: .6 });
});
