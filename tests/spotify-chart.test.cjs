/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads the app through the TypeScript hook. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { chartShardPath, parseChart, findPublishedChart } = require("../src/lib/progressions/publishedChart");
const { SPOTIFY_SONG_IDS } = require("../src/lib/progressions/spotifyTracks");
const { SONGS } = require("../src/lib/progressions/songPath");

test("an out-of-library track opens the same published sections with gzip or HTTP-decoded bytes", async t => {
  const id = "2ffJZ2r8HxI5DHcmf3BO6c";
  const shardPath = chartShardPath(id);
  const compressed = fs.readFileSync(path.join(__dirname, "../public", shardPath));
  assert.equal(SPOTIFY_SONG_IDS[id], undefined);
  let bytes = compressed;
  const fetchMock = t.mock.method(globalThis, "fetch", async url => {
    assert.equal(url, shardPath);
    return new Response(bytes);
  });
  const signal = new AbortController().signal;
  const result = await findPublishedChart(id, signal);
  assert.deepEqual(result[0], { name: "Intro 1", chords: ["E", "D", "A/C♯", "E", "D", "A/C♯"] });
  bytes = gunzipSync(compressed);
  assert.deepEqual(await findPublishedChart(id, signal), result);
  fetchMock.mock.mockImplementation(async () => new Response("{}"));
  assert.equal(await findPublishedChart(id, signal), null);
  fetchMock.mock.mockImplementation(async () => new Response("", { status: 503 }));
  await assert.rejects(findPublishedChart(id, signal), /unavailable/i);
  assert.throws(() => chartShardPath("../catalog"));
});

test("chart display preserves untagged material, slash bass, suspensions, and repeated sections", () => {
  assert.deepEqual(parseChart("Fsmin Gsus4 Bb7 <verse_1> Fssus4 A/Cs <verse_1> Bsus4"), [
    { name: "Progression", chords: ["F♯m", "Gsus4", "B♭7"] },
    { name: "Verse 1", chords: ["F♯sus4", "A/C♯"] },
    { name: "Verse 1", chords: ["Bsus4"] },
  ]);
  assert.deepEqual(parseChart("<intro_1>"), []);
  assert.deepEqual(new Set(Object.values(SPOTIFY_SONG_IDS)), new Set(SONGS.map(song => song.id)));
});
