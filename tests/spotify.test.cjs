/* eslint-disable @typescript-eslint/no-require-imports -- Node's dependency-free test runner. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto, createHash } = require("node:crypto");

const CLIENT_ID = "0123456789abcdef0123456789abcdef";
const PENDING_KEY = "body-synth:spotify-pkce";
const token = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "Bearer", expires_in: 3600, scope: "user-top-read" };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const flush = () => new Promise(setImmediate);

function setup(t, initialUrl = "https://body-synth.example/for-you") {
  const previous = new Map(["window", "crypto", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let url = new URL(initialUrl);
  let navigation;
  const values = new Map();
  const calls = [];
  let handler = () => { throw new Error("Unexpected fetch"); };
  const fakeWindow = {
    get location() {
      return { href: url.href, origin: url.origin, hostname: url.hostname, protocol: url.protocol, pathname: url.pathname, assign: (href) => { navigation = new URL(href); } };
    },
    history: { state: { retained: true }, replaceState: (_state, _title, href) => { url = new URL(href, url); } },
    sessionStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
  };
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, "fetch", { value: async (href, options) => {
    calls.push({ href, options });
    return handler(href, options);
  }, configurable: true });
  const modulePath = require.resolve("../src/lib/spotify/client.ts");
  delete require.cache[modulePath];
  const client = require(modulePath);
  t.after(() => {
    client.disconnectSpotify();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    client, values, calls,
    navigation: () => navigation,
    url: () => url,
    respond: (next) => { handler = next; },
    callback: (params) => { url = new URL("/for-you?" + new URLSearchParams(params), url); },
    pending: () => JSON.parse(values.get(PENDING_KEY)),
  };
}

async function begin(run, extra = {}) {
  await run.client.startSpotifyLogin(CLIENT_ID);
  const pending = run.pending();
  run.callback({ code: "test-authorization-code", state: pending.state, ...extra });
  return pending;
}

test("Spotify connection requests only top-track access with independent random state and S256 PKCE", async (t) => {
  const run = setup(t);
  await run.client.startSpotifyLogin(CLIENT_ID);
  const pending = run.pending();
  const authorization = run.navigation();
  assert.equal(authorization.origin, "https://accounts.spotify.com");
  assert.equal(authorization.pathname, "/authorize");
  assert.equal(authorization.searchParams.get("scope"), "user-top-read");
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://body-synth.example/for-you");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("code_challenge"), createHash("sha256").update(pending.verifier).digest("base64url"));
  assert.match(pending.state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(pending.state, pending.verifier);
  assert.equal(authorization.searchParams.has("code_verifier"), false);
  assert.equal(run.calls.length, 0);
  await assert.rejects(run.client.startSpotifyLogin(CLIENT_ID), /already in progress/);
});

for (const [url, allowed] of [
  ["http://localhost:3000/for-you", false],
  ["http://192.168.1.2:3000/for-you", false],
  ["http://127.0.0.1:3000/for-you", true],
  ["http://[::1]:3000/for-you", true],
]) {
  test(`Spotify redirect ${allowed ? "accepts" : "rejects"} ${url}`, async (t) => {
    const run = setup(t, url);
    if (allowed) {
      assert.equal(run.client.spotifyRedirectUri(), url);
      await run.client.startSpotifyLogin(CLIENT_ID);
    } else await assert.rejects(run.client.startSpotifyLogin(CLIENT_ID), /HTTPS|localhost/);
    assert.equal(run.calls.length, 0);
  });
}

for (const failure of ["state mismatch", "expired", "future timestamp", "duplicate state", "duplicate code", "wrong origin"]) {
  test(`Spotify OAuth fails closed for ${failure}, consumes the attempt, and cleans the callback`, async (t) => {
    const run = setup(t);
    const pending = await begin(run, { retained: "yes" });
    if (failure === "state mismatch") run.callback({ code: "secret-code", state: "untrusted", retained: "yes" });
    if (failure === "expired") pending.createdAt = Date.now() - 11 * 60 * 1000;
    if (failure === "future timestamp") pending.createdAt = Date.now() + 60_000;
    if (failure === "wrong origin") pending.redirectUri = "https://untrusted.example/for-you";
    run.values.set(PENDING_KEY, JSON.stringify(pending));
    if (failure === "duplicate state" || failure === "duplicate code") {
      const params = new URLSearchParams({ code: "secret-code", state: pending.state, retained: "yes" });
      params.append(failure === "duplicate state" ? "state" : "code", "duplicate");
      run.callback(params);
    }
    await assert.rejects(run.client.finishSpotifyLogin(), /could not be verified/);
    assert.equal(run.calls.length, 0);
    assert.equal(run.values.size, 0);
    assert.equal(run.url().searchParams.has("code"), false);
    assert.equal(run.url().searchParams.has("state"), false);
    assert.equal(run.url().searchParams.get("retained"), "yes");
    assert.deepEqual(await run.client.finishSpotifyLogin(), { connected: false, tracks: [] });
  });
}

test("Spotify permission denial reveals no remote error details and makes no token request", async (t) => {
  const run = setup(t);
  await begin(run, { error: "access_denied", error_description: "untrusted-secret-value" });
  await assert.rejects(run.client.finishSpotifyLogin(), (error) => {
    assert.match(error.message, /permission was not granted/);
    assert.equal(error.message.includes("untrusted-secret-value"), false);
    return true;
  });
  assert.equal(run.calls.length, 0);
  assert.equal(run.url().search, "");
});

test("Spotify callback is exchanged once and filters malformed tracks without trusting external URLs", async (t) => {
  const run = setup(t);
  const pending = await begin(run);
  const good = { id: "1234567890123456789012", name: " YUKON ", artists: [{ name: "Justin Bieber" }], external_urls: { spotify: "javascript:alert(1)" }, type: "track" };
  run.respond((href) => href.includes("/api/token") ? json(token) : json({ items: [
    good, good, { ...good, id: "../../evil" }, { ...good, id: "2234567890123456789012", name: "bad\u0000name" },
    { ...good, id: "3234567890123456789012", artists: [] }, { ...good, id: "4234567890123456789012", is_local: true },
    { ...good, id: "5234567890123456789012", type: "episode" },
  ] }));
  const first = run.client.finishSpotifyLogin();
  const second = run.client.finishSpotifyLogin();
  assert.equal(first, second);
  assert.deepEqual(await first, { connected: true, tracks: [{ id: good.id, name: "YUKON", artists: ["Justin Bieber"], url: "https://open.spotify.com/track/" + good.id }] });
  assert.equal(run.calls.length, 2);
  const exchange = run.calls[0].options;
  assert.equal(exchange.body.get("code_verifier"), pending.verifier);
  assert.equal(exchange.body.has("client_secret"), false);
  assert.equal(exchange.body.get("redirect_uri"), pending.redirectUri);
  assert.equal(run.calls[1].options.headers.Authorization, "Bearer test-access-token");
  assert.match(run.calls[1].href, /limit=50&time_range=short_term$/);
  assert.equal(run.values.size, 0, "No credentials or account content remain in storage");
  assert.equal(run.url().search, "");
  run.client.disconnectSpotify();
  await assert.rejects(run.client.getTopTracks(), /Connect Spotify/);
});

test("Spotify accepts at most 50 track items and does not follow pagination supplied by a response", async (t) => {
  const run = setup(t);
  await begin(run);
  run.respond((href) => href.includes("/api/token") ? json(token) : json({
    next: "https://untrusted.example/steal-token",
    items: Array.from({ length: 70 }, (_, index) => ({ id: String(index).padStart(22, "0"), name: "Track " + index, artists: [{ name: "Artist" }] })),
  }));
  const result = await run.client.finishSpotifyLogin();
  assert.equal(result.tracks.length, 50);
  assert.equal(run.calls.length, 2);
  await assert.rejects(run.client.getTopTracks("untrusted&limit=1000"), /valid Spotify listening period/);
  assert.equal(run.calls.length, 2);
});

for (const [status, message] of [[401, /expired/], [403, /Premium.*allowed/], [429, /17 seconds/]]) {
  test(`Spotify ${status} response produces a useful message without exposing its body`, async (t) => {
    const run = setup(t);
    await begin(run);
    run.respond((href) => href.includes("/api/token") ? json(token) : json({ error: "secret-remote-response" }, status, { "Retry-After": "17" }));
    await assert.rejects(run.client.finishSpotifyLogin(), (error) => {
      assert.match(error.message, message);
      assert.equal(error.message.includes("secret-remote-response"), false);
      return true;
    });
    assert.equal(run.values.size, 0);
  });
}

for (const stage of ["token exchange", "track fetch"]) {
  test(`Disconnect during Spotify ${stage} cancels the request and cannot restore credentials`, async (t) => {
    const run = setup(t);
    await begin(run);
    let finish;
    run.respond((href) => {
      if (stage === "track fetch" && href.includes("/api/token")) return json(token);
      return new Promise((resolve) => { finish = resolve; });
    });
    const completing = run.client.finishSpotifyLogin();
    await flush();
    assert.equal(typeof finish, "function");
    run.client.disconnectSpotify();
    assert.equal(run.calls.at(-1).options.signal.aborted, true);
    finish(stage === "token exchange" ? json(token) : json({ items: [] }));
    await assert.rejects(completing, /cancelled/);
    await assert.rejects(run.client.getTopTracks(), /Connect Spotify/);
    assert.equal(run.values.size, 0);
  });
}

test("Disconnect before a Spotify request starts prevents sending the previously resolved bearer token", async (t) => {
  const run = setup(t);
  await begin(run);
  run.respond((href) => href.includes("/api/token") ? json(token) : json({ items: [] }));
  await run.client.finishSpotifyLogin();
  const previousCalls = run.calls.length;
  const fetching = run.client.getTopTracks();
  run.client.disconnectSpotify();
  await assert.rejects(fetching, /cancelled/);
  assert.equal(run.calls.length, previousCalls, "Disconnect stops the request before its authorization header is sent");
});

test("An abandoned Spotify login can be cleared and retried with a fresh state and verifier", async (t) => {
  const run = setup(t);
  await run.client.startSpotifyLogin(CLIENT_ID);
  const abandoned = run.pending();
  assert.deepEqual(await run.client.finishSpotifyLogin(), { connected: false, tracks: [] });
  assert.equal(run.calls.length, 0);
  run.client.disconnectSpotify();
  assert.equal(run.values.size, 0);
  await run.client.startSpotifyLogin(CLIENT_ID);
  const fresh = run.pending();
  assert.notEqual(fresh.state, abandoned.state);
  assert.notEqual(fresh.verifier, abandoned.verifier);
  run.callback({ code: "new-authorization-code", state: fresh.state });
  run.respond((href) => href.includes("/api/token") ? json(token) : json({ items: [] }));
  assert.deepEqual(await run.client.finishSpotifyLogin(), { connected: true, tracks: [] });
  assert.equal(run.calls.length, 2);
  assert.equal(run.calls[0].options.body.get("code_verifier"), fresh.verifier);
  assert.equal(run.values.size, 0);
});

test("An expired Spotify token refreshes only on demand and the rotated token is forgotten on disconnect", async (t) => {
  const run = setup(t);
  await begin(run);
  let exchanges = 0;
  run.respond((href) => {
    if (!href.includes("/api/token")) return json({ items: [] });
    exchanges++;
    return json({ ...token, access_token: `test-token-${exchanges}`, expires_in: exchanges === 1 ? 1 : 3600 });
  });
  await run.client.finishSpotifyLogin();
  assert.equal(exchanges, 2, "Near-expired initial token refreshes before an explicit top-track request");
  const refresh = run.calls[1].options.body;
  assert.equal(refresh.get("grant_type"), "refresh_token");
  assert.equal(refresh.get("client_id"), CLIENT_ID);
  assert.equal(refresh.get("refresh_token"), token.refresh_token);
  assert.equal(refresh.has("client_secret"), false);
  await flush();
  assert.equal(exchanges, 2, "No timer fetches in the background");
  run.client.disconnectSpotify();
  await assert.rejects(run.client.getTopTracks(), /Connect Spotify/);
});
