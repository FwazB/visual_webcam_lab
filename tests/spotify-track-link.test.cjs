/* eslint-disable @typescript-eslint/no-require-imports -- Node's TypeScript test bootstrap. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseSpotifyTrackLink, resolveSpotifyTrackId } = require("../src/lib/spotify/trackLink.ts");
const { GET } = require("../src/app/api/spotify/resolve/route.ts");

const id = "7xtG2Kac0KPcd1ThPEGbZw";
const canonical = `https://open.spotify.com/track/${id}`;
const share = "https://spotify.link/hRkBrwub9xb";
const endpoint = "https://body-synth.example/api/spotify/resolve";
const routeRequest = (url, headers) => new Request(endpoint + "?" + new URLSearchParams({ url }), { headers });

test("canonical, localized, and URI track links resolve without a network request", async t => {
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network request"));
  for (const url of [canonical, ` spotify:track:${id} `, canonical + "/?si=share",
    `https://open.spotify.com/intl-fr/track/${id}?si=share#context`,
    `https://open.spotify.com/intl-pt-BR/track/${id}`]) {
    assert.deepEqual(parseSpotifyTrackLink(url), { kind: "track", id });
    assert.equal(await resolveSpotifyTrackId(url), id);
  }
  assert.equal(network.mock.callCount(), 0);
});

test("rejects unsupported objects, malformed track IDs, schemes and authorities", async t => {
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network request"));
  for (const url of ["", id, "spotify:album:" + id, "spotify:track:A", canonical + "Z", canonical + "/extra",
    canonical.replace("/track/", "/playlist/"), canonical.replace("/track/", "/embed/track/"),
    canonical.replace("/track/", "/album/../track/"), canonical.replace("https:", "http:"),
    canonical.replace("https://", "//"), canonical.replace("https://", "https://visitor@"),
    canonical.replace(".com/", ".com:9000/"), canonical.replace(".com/", ".com:443/"),
    canonical.replace(".com/", ".com.invalid/"), canonical.replace("https://", "https://elsewhere.invalid/?url="),
    "https://spotify.link@elsewhere.invalid/short", "https://elsewhere.invalid@spotify.link/short",
    "https://spotify.app.link/short/more", "https://spotify.link/%2f%2felsewhere.invalid",
    "https://spotify.link:443/short", "https://spotify.link/short\\other", "text " + canonical]) {
    assert.equal(parseSpotifyTrackLink(url), null, url);
    await assert.rejects(resolveSpotifyTrackId(url), { name: "SpotifyLinkError", message: /Spotify track link/ });
  }
  assert.equal(network.mock.callCount(), 0);
});

test("the client sends only the normalized short link to the same origin", async t => {
  const signal = new AbortController().signal;
  const network = t.mock.method(globalThis, "fetch", async () => Response.json({ id }));
  assert.deepEqual(parseSpotifyTrackLink(share + "?si=private"), { kind: "short", url: share });
  assert.equal(await resolveSpotifyTrackId(share + "?si=private#fragment", signal), id);
  const [input, options] = network.mock.calls[0].arguments;
  const target = new URL(input, endpoint);
  assert.equal(target.origin + target.pathname, endpoint);
  assert.deepEqual([...target.searchParams], [["url", share]]);
  assert.equal(options.mode, "same-origin");
  assert.equal(options.credentials, "omit");
  assert.equal(options.signal, signal);

  network.mock.mockImplementation(async () => Response.json({ id: "malformed" }));
  await assert.rejects(resolveSpotifyTrackId(share), { name: "SpotifyLinkError", message: /full open\.spotify\.com\/track address/ });
  network.mock.mockImplementation(async () => new Response(null, { status: 429 }));
  await assert.rejects(resolveSpotifyTrackId(share), { name: "SpotifyLinkError", message: /Try again in a minute/ });
  const aborted = AbortSignal.abort();
  network.mock.mockImplementation(async () => { throw aborted.reason; });
  await assert.rejects(resolveSpotifyTrackId(share, aborted), error => error === aborted.reason);
});

test("short-link resolution manually follows validated hops and stops at the track ID", async t => {
  const next = share.replace("spotify.link", "spotify.app.link");
  const network = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "HEAD");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.redirect(url === share ? next + "?_p=branch&other=strip" : canonical + "?si=tracking", 307);
  });
  const response = await GET(routeRequest(share + "?si=private"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await response.json(), { id });
  assert.deepEqual(network.mock.calls.map(call => call.arguments[0]), [share, next + "?_p=branch"]);
});

test("the endpoint rejects unexpected inputs without making requests", async t => {
  const network = t.mock.method(globalThis, "fetch", () => assert.fail("Unexpected network request"));
  for (const url of [canonical, "https://example.org/track", "https://spotify.link:8443/token", "spotify:track:" + id]) {
    assert.equal((await GET(routeRequest(url))).status, 400);
  }
  const duplicate = new URL(routeRequest(share).url);
  duplicate.searchParams.append("url", share);
  assert.equal((await GET(new Request(duplicate))).status, 400);
  assert.equal((await GET(routeRequest(share, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal(network.mock.callCount(), 0);
});

test("unsupported destinations and loops stop without contacting their targets", async t => {
  const network = t.mock.method(globalThis, "fetch", async () => new Response());
  for (const location of ["https://example.org/link", "https://spotify.link.example.org/short", "http://spotify.link/other",
    "//example.org/link", "/one/two", "https://open.spotify.com/album/" + id, share + "?again=1"]) {
    network.mock.resetCalls();
    network.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location } }));
    assert.equal((await GET(routeRequest(share))).status, 422, location);
    assert.equal(network.mock.callCount(), 1);
  }
  network.mock.resetCalls();
  network.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/hop" + network.mock.callCount() } }));
  assert.equal((await GET(routeRequest(share))).status, 422);
  assert.equal(network.mock.callCount(), 3);
  network.mock.mockImplementation(async () => { throw new TypeError("Network error"); });
  assert.equal((await GET(routeRequest(share))).status, 502);
});

test("valid short links share bounded rolling client and instance budgets before any upstream work", async t => {
  const originalVercel = process.env.VERCEL;
  t.after(() => {
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });
  let now = performance.now() + 60_000;
  t.mock.method(performance, "now", () => now);
  const network = t.mock.method(globalThis, "fetch", async () => Response.redirect(canonical));
  const lookup = ip => GET(routeRequest(share, { "x-vercel-forwarded-for": ip }));

  delete process.env.VERCEL;
  for (let i = 1; i <= 12; i++) assert.equal((await lookup("192.0.2." + i)).status, 200);
  assert.equal((await lookup("192.0.2.13")).status, 429, "outside Vercel, callers share the unknown-client budget");

  process.env.VERCEL = "1";
  assert.equal((await lookup("invalid")).status, 429, "unusable proxy values also share that budget");
  now += 60_000;
  const requests = Array.from({ length: 13 }, () => lookup("2001:db8::1"));
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map(r => r.status), [...Array(12).fill(200), 429]);
  assert.equal(responses[12].headers.get("retry-after"), "60");
  assert.match(responses[12].headers.get("cache-control"), /no-store/);

  now += 30_100;
  for (let i = 1; i <= 108; i++) assert.equal((await lookup("192.0.2." + i)).status, 200);
  const limited = await lookup("192.0.2.200");
  assert.equal(limited.status, 429, "a new client also observes the aggregate limit");
  assert.equal(limited.headers.get("retry-after"), "30");
  assert.equal(network.mock.callCount(), 12 + 120, "denied attempts never contact Spotify");
  now += 29_900;
  assert.equal((await lookup("2001:db8::1")).status, 200, "the original admissions expire on time");
});
