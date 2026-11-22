/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test runner loads TypeScript through tests/register.cjs. */
const test = require("node:test");
const assert = require("node:assert/strict");

const { LEVELS, SONGS } = require("../src/lib/progressions/songPath");
const { PRACTICE_SONGS } = require("../src/lib/practice/catalog");

test("the library orders distinct, sourced song sections from easy to advanced", () => {
  assert.deepEqual(LEVELS.map(level => level.id), ["easy", "intermediate", "advanced"]);
  assert.equal(new Set(SONGS.map(song => song.id)).size, SONGS.length);
  assert.equal(SONGS[0].id, "three-little-birds");
  assert.deepEqual(SONGS.map(song => song.id),
    LEVELS.flatMap(level => SONGS.filter(song => song.level === level.id).map(song => song.id)));
  for (const level of LEVELS) {
    assert.ok(level.guitarFocus && level.bassFocus);
    assert.ok(level.bpm >= 40 && level.bpm <= 120);
    const songs = SONGS.filter(song => song.level === level.id);
    assert.ok(songs.length >= 2);
    for (const song of songs) {
      assert.ok(song.section && song.arrangement && song.artist && song.title);
      assert.equal(new URL(song.sourceUrl).protocol, "https:");
      const recording = new URL(song.listenUrl);
      assert.equal(recording.protocol, "https:");
      assert.equal(recording.hostname, "music.apple.com");
      assert.match(recording.pathname, /^\/us\/song\/[a-z0-9-]+\/\d+$/);
      assert.ok(song.sourceLabel);
      const changes = new Set(song.chart.map(step => step.name));
      assert.ok(changes.size >= 2);
      if (level.id === "easy") {
        assert.ok([...changes].every(name => ["A", "C", "D", "E", "G", "Am", "Dm", "Em"].includes(name)));
      }
    }
  }
  const standByMe = SONGS.find(song => song.id === "stand-by-me");
  assert.equal(standByMe.sourceUrl, PRACTICE_SONGS.find(song => song.id === standByMe.id).arrangements.guitar.sourceUrl);
});

test("the excerpt order and beat lengths survive repeated chords and split bars", () => {
  const charts = Object.fromEntries(SONGS.map(song => [
    song.id, song.chart.map(step => [step.name, step.beats]),
  ]));
  assert.deepEqual(charts, {
    "three-little-birds": [["A", 8], ["D", 4], ["A", 4]],
    "bad-moon-rising": [["D", 4], ["A", 2], ["G", 2], ["D", 8]],
    "sweet-home-alabama": [["D", 2], ["C", 2], ["G", 4]],
    zombie: [["Em", 4], ["C", 4], ["G", 4], ["D", 4]],
    "knockin-on-heavens-door": [["G", 2], ["D", 2], ["Am", 4], ["G", 2], ["D", 2], ["C", 4]],
    "stand-by-me": [["A", 8], ["F♯m", 8], ["D", 4], ["E", 4], ["A", 8]],
    "let-it-be": [["C", 2], ["G", 2], ["Am", 2], ["F", 2]],
    "go-your-own-way": [["Dm", 4], ["B♭", 4], ["C", 8]],
    valerie: [["A♭", 4], ["Gm", 4], ["A♭", 4], ["Gm", 4], ["A♭", 4], ["Gm", 4], ["B♭", 8]],
    creep: [["G", 8], ["B", 8], ["C", 8], ["Cm", 8]],
    "where-is-my-mind": [["E", 2], ["C♯m", 2], ["G♯", 2], ["A", 2]],
    "get-lucky": [["Bm", 4], ["D", 4], ["F♯m", 4], ["E", 4]],
    "blinding-lights": [["Fm", 8], ["Cm", 8], ["E♭", 8], ["B♭", 8]],
    levitating: [["Bm", 2], ["F♯m", 2], ["Em", 2], ["Bm", 2]],
  });
});

test("the displayed chord name, quality, and scale degree match the sounding pitch", () => {
  const natural = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const interval = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
  for (const song of SONGS) {
    for (const { name, root, quality, numeral } of song.chart) {
      const match = /^([A-G])(♭|♯)?(m)?$/.exec(name);
      assert.ok(match);
      assert.equal(root, (natural[match[1]] + (match[2] === "♯" ? 1 : match[2] === "♭" ? -1 : 0) + 12) % 12);
      const degree = numeral.toUpperCase().replace(/^♭/, "");
      const alteration = numeral.startsWith("♭") ? -1 : 0;
      assert.equal(root, (song.practiceKey + interval[degree] + alteration + 12) % 12);
      assert.equal(quality, match[3] ? "minor" : "major");
      assert.equal(quality, numeral === numeral.toLowerCase() ? "minor" : "major");
    }
  }
});
