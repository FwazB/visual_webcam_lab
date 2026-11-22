/* eslint-disable @typescript-eslint/no-require-imports -- Node's test runner loads TypeScript through tests/register.cjs. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { requestPlaybackSession } = require("../src/lib/progressions/playbackSession");

test("a playback request lasts until the final player releases it", t => {
  const session = { type: "ambient" };
  t.mock.getter(globalThis, "navigator", () => ({ audioSession: session }));
  const releaseFirst = requestPlaybackSession();
  const releaseSecond = requestPlaybackSession();
  assert.equal(session.type, "playback");
  releaseFirst();
  releaseFirst();
  assert.equal(session.type, "playback");
  releaseSecond();
  assert.equal(session.type, "ambient");
});

test("playback preserves existing media requests and yields to microphone routing", t => {
  const session = { type: "playback" };
  t.mock.getter(globalThis, "navigator", () => ({ audioSession: session }));
  requestPlaybackSession()();
  assert.equal(session.type, "playback");
  session.type = "auto";
  const release = requestPlaybackSession();
  assert.equal(session.type, "playback");
  session.type = "play-and-record";
  assert.doesNotThrow(release);
  requestPlaybackSession()();
  assert.equal(session.type, "play-and-record");
});

test("missing or restricted audio-session support leaves regular Web Audio available", t => {
  let browser;
  t.mock.getter(globalThis, "navigator", () => browser);
  const requestAndRelease = () => requestPlaybackSession()();
  assert.doesNotThrow(requestAndRelease);
  browser = {};
  assert.doesNotThrow(requestAndRelease);
  browser = { get audioSession() { throw new Error("unavailable"); } };
  assert.doesNotThrow(requestAndRelease);
  browser = { audioSession: Object.freeze({ type: "auto" }) };
  assert.doesNotThrow(requestAndRelease);
  browser = { audioSession: { type: "auto" } };
  const release = requestPlaybackSession();
  Object.freeze(browser.audioSession);
  assert.doesNotThrow(release);
});
