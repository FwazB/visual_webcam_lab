/* eslint-disable @typescript-eslint/no-require-imports -- Uses tests/register.cjs. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { recommendSongs, starterSongs } = require("../src/lib/practice/recommendations");
const { PRACTICE_SONGS } = require("../src/lib/practice/catalog");

const guitar = { instrument: "guitar", level: 1, goal: "any" };
const track = (id, name, ...artists) => ({ id, name, artists, url: `https://open.spotify.com/track/${id}` });

test("matches punctuation, remasters and feature credits without matching covers", () => {
  const cards = recommendSongs([
    track("a", "Ain’t No Sunshine – 2015 Remaster", "Bill Withers"),
    track("b", "Best Part (feat. H.E.R.)", "Daniel Caesar", "H.E.R."),
    track("c", "Ain't No Sunshine", "Another Artist"),
  ], guitar);
  assert.deepEqual(cards.map((card) => card.status), ["matched", "matched", "unassessed"]);
  assert.deepEqual(cards.slice(0, 2).map((card) => card.catalog.id), ["aint-no-sunshine", "best-part"]);
});

test("live, acoustic and remix editions remain unassessed", () => {
  const cards = recommendSongs([
    track("a", "YUKON - Live", "Justin Bieber"),
    track("b", "YUKON (Acoustic)", "Justin Bieber"),
    track("c", "Get Lucky - Remix", "Daft Punk"),
  ], guitar);
  assert.ok(cards.every((card) => card.status === "unassessed" && card.arrangement === null));
});

test("classifies within-level, one-level stretch and later goal independently", () => {
  const cards = recommendSongs([
    track("hard", "Get Lucky", "Daft Punk"),
    track("medium", "YUKON", "Justin Bieber"),
    track("easy", "Stand By Me", "Ben E. King"),
  ], guitar);
  assert.deepEqual(cards.map((card) => [card.track.id, card.fit]), [
    ["easy", "play-now"], ["medium", "stretch"], ["hard", "goal"],
  ]);
  assert.equal(recommendSongs([track("hard", "Get Lucky", "Daft Punk")], { ...guitar, level: 3 })[0].fit, "play-now");
});

test("changes arrangement by instrument and reports known songs without an arrangement", () => {
  const yukon = track("a", "YUKON", "Justin Bieber");
  assert.equal(recommendSongs([yukon], guitar)[0].arrangement.level, 2);
  const bass = recommendSongs([yukon, track("b", "Best Part", "Daniel Caesar")], { ...guitar, instrument: "bass" });
  assert.equal(bass[0].arrangement.level, 1);
  assert.equal(bass[0].fit, "play-now");
  assert.equal(bass[1].status, "wrong-instrument");
  assert.equal(bass[1].arrangement, null);
});

test("explicit practice goal orders equally playable sections, preserving ties", () => {
  const candidates = [track("a", "Stand By Me", "Ben E. King"), track("b", "Seven Nation Army", "The White Stripes"), track("c", "Ain't No Sunshine", "Bill Withers")];
  assert.deepEqual(recommendSongs(candidates, { ...guitar, goal: "riffs" }).map((card) => card.track.id), ["b", "a", "c"]);
  assert.deepEqual(recommendSongs(candidates, guitar).map((card) => card.track.id), ["a", "b", "c"]);
});

test("unassessed songs retain order and never acquire an invented level", () => {
  const cards = recommendSongs([track("a", "Unknown One", "Singer"), track("b", "Unknown Two", "Singer")], guitar);
  assert.deepEqual(cards.map((card) => card.track.id), ["a", "b"]);
  assert.ok(cards.every((card) => card.catalog === null && card.arrangement === null && card.fit === "unassessed"));
});

test("deduplicates repeated track ids without mutating source candidates", () => {
  const candidate = Object.freeze({ ...track("a", "YUKON", "Justin Bieber"), artists: Object.freeze(["Justin Bieber"]) });
  const candidates = Object.freeze([candidate, candidate]);
  const cards = recommendSongs(candidates, guitar);
  assert.equal(cards.length, 1);
  assert.equal(candidate.name, "YUKON");
});

test("starter sections match the instrument and only existing YUKON exercises claim a chart", () => {
  for (const instrument of ["guitar", "bass"]) {
    const cards = starterSongs({ instrument, level: 1, goal: "any" });
    assert.ok(cards.length >= 5);
    assert.ok(cards.every((card) => card.track === null && card.status === "matched" && card.arrangement));
  }
  for (const song of PRACTICE_SONGS) {
    for (const arrangement of Object.values(song.arrangements)) {
      assert.ok(arrangement.focus && arrangement.section && arrangement.sourceUrl);
      if (arrangement.chartId) assert.equal(song.id, "yukon");
    }
  }
});
