/* eslint-disable @typescript-eslint/no-require-imports -- Runs in Node's CommonJS test runner with tests/register.cjs. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { midiToHz, pitchClassHue } = require("../src/lib/instrument/pitch");
const { amplitudeFor, crossedStrings, displacement, energy, SETTLED } = require("../src/lib/home/strings");
const { cloudString, karplusStrong } = require("../src/lib/home/pluck");
const { PROJECTS, STRUNG_PROJECTS } = require("../src/lib/home/projects");

test("the seventh project has its own playable A string and preserves the original six", () => {
  assert.equal(STRUNG_PROJECTS.length, 7);
  assert.deepEqual(STRUNG_PROJECTS.slice(0, 6).map(({ id, stringLabel, midi, gauge, voice }) =>
    [id, stringLabel, midi, gauge, voice]), [
    ["guitar", "E", 40, 3.4, "pluck"],
    ["bass", "A", 45, 2.9, "pluck"],
    ["studio", "D", 50, 2.4, "pluck"],
    ["for-you", "G", 55, 2, "pluck"],
    ["ascii", "B", 59, 1.6, "pluck"],
    ["fuzz", "e", 64, 1.3, "pluck"],
  ]);
  const seventh = STRUNG_PROJECTS[6];
  assert.equal(seventh.id, "pocket-operators");
  assert.equal(seventh.href, "/pocket-operators");
  assert.equal(seventh.external, false);
  assert.equal(seventh.stringLabel, "A");
  assert.equal(seventh.midi, 33);
  assert.equal(midiToHz(seventh.midi), 55);
  assert.equal(seventh.voice, "cloud");
  for (const project of STRUNG_PROJECTS) {
    assert.ok(Number.isFinite(project.gauge) && project.gauge > 0, `${project.id} needs a drawable gauge`);
    assert.ok(Number.isInteger(project.midi), `${project.id} needs a playable note`);
    assert.equal(project.pitchClass, project.midi % 12, `${project.id} color must match its note`);
  }
  assert.equal(new Set(PROJECTS.map(project => project.id)).size, PROJECTS.length);
  assert.equal(PROJECTS.filter(project => project.href === "/pocket-operators").length, 1);
});

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

test("pointer sweeps and a bottom-row pluck include the seventh string", () => {
  const ys = [10, 20, 30, 40, 50, 60, 70];
  assert.deepEqual(crossedStrings(5, 75, ys), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(crossedStrings(75, 5, ys), [6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual(crossedStrings(65, 75, ys), [6]);
  assert.deepEqual(crossedStrings(75, 65, ys), [6]);
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

for (const sampleRate of [44100, 48000]) {
  test(`the cloud A string produces bounded, decaying audio at ${sampleRate} Hz`, () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = cloudString(midiToHz(STRUNG_PROJECTS[6].midi), sampleRate, 2.5, random);
    assert.equal(out.length, Math.round(sampleRate * 2.5));
    assert.ok(out.every(Number.isFinite), "the audio buffer must not contain NaN or infinity");
    assert.ok(out.every(value => Math.abs(value) <= 1), "distortion must remain bounded");
    const rms = (from, to) => {
      const samples = out.subarray(Math.round(from * sampleRate), Math.round(to * sampleRate));
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    };
    assert.ok(rms(0.05, 0.4) > 0.01, "the seventh voice must be audible, not an empty buffer");
    assert.ok(rms(2, 2.4) < rms(0.05, 0.4) * 0.5, "the note must decay before its final fade");
    assert.equal(out.at(-1), 0, "the buffer must end without a discontinuity");
  });
}
