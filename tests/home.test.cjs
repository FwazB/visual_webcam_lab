/* eslint-disable @typescript-eslint/no-require-imports -- Runs in Node's CommonJS test runner with tests/register.cjs. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pitchClassHue } = require("../src/lib/instrument/pitch");
const { amplitudeFor, crossedStrings, displacement, energy, SETTLED } = require("../src/lib/home/strings");
const { karplusStrong } = require("../src/lib/home/pluck");

test("homepage string colors match the Fuzz circle-of-fifths palette", () => {
  assert.equal(pitchClassHue(4), 60); // E yellow
  assert.equal(pitchClassHue(9), 120); // A green
  assert.ok(Math.abs(pitchClassHue(11) - 32.727) < 0.01); // B, last fifth
  assert.equal(pitchClassHue(4 + 24), 60); // octaves share a color
});

test("a pointer sweep plucks the strings it crosses, in sweep order", () => {
  const ys = [10, 20, 30, 40, 50, 60];
  assert.deepEqual(crossedStrings(5, 35, ys), [0, 1, 2]);
  assert.deepEqual(crossedStrings(55, 15, ys), [4, 3, 2, 1]);
  assert.deepEqual(crossedStrings(21, 29, ys), []);
  assert.deepEqual(crossedStrings(19, 20, ys), [1]);
  assert.ok(amplitudeFor(100, 40) <= 40 * 0.42);
});

test("a pluck starts near its amplitude at the pluck point and settles", () => {
  const pluck = { at: 0.3, amplitude: 12, t0: 1 };
  assert.ok(Math.abs(displacement(pluck, 0.3, 1) - 12) < 1.5);
  assert.equal(displacement(pluck, 0, 1.2), 0);
  assert.equal(displacement(pluck, 0.5, 0.5), 0);
  assert.ok(energy(pluck, 6) < SETTLED);
  // A frame timestamped just before the pluck must not discard it.
  assert.equal(energy(pluck, 0.99), 1);
  assert.ok(Math.abs(displacement(pluck, 0.3, 6)) < 12 * SETTLED);
});

test("a Karplus-Strong pluck has the requested length and dies away", () => {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = karplusStrong(82.41, 48000, 2, random);
  assert.equal(out.length, 96000);
  const peak = (from, to) => out.slice(from, to).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak(0, 2400) > 0.3);
  assert.ok(peak(84000, 96000) < peak(0, 2400) * 0.2);
  assert.equal(out[out.length - 1], 0);
});
