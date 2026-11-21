/* eslint-disable @typescript-eslint/no-require-imports -- Repository tests use the CommonJS TypeScript loader. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { consumeMotionLink, HeadMotionClient, MOTION_URL } = require("../src/lib/headMotion.ts");

const code = "another-example-code";
const tick = () => new Promise(resolve => setImmediate(resolve));
const owned = { enabled: true, owned: true, degrees: -17.5, status: "Tracking" };
const stopped = { enabled: false, owned: false, degrees: null, status: "Off" };

function setup(t, launch) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const calls = [];
  const client = new HeadMotionClient((url, options) => new Promise((resolve, reject) => {
    calls.push({ url, options, command: JSON.parse(options.body), fail: reject,
      reply: (data, status = 200) => resolve(Response.json(data, { status })) });
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }), launch);
  t.after(() => client.stop());
  return { calls, client };
}

test("pairing link removes only the exact bridge fragment from the production home", () => {
  const token = "ABCDEFGHIJKLMNOPQRSTUV_-";
  const base = { origin: "https://body-synth-beta.vercel.app", pathname: "/", hash: "#motion-code=" + token, search: "" };
  const calls = [];
  const history = { state: { key: "next-router" }, replaceState: (...args) => calls.push(args) };
  for (const override of [{ hash: "#guide" }, { hash: "#motion-code=short" }, { pathname: "/for-you" },
    { search: "?code=oauth-code&state=spotify" }, { hash: base.hash + "&next=other" }, { origin: "https://other.example" }]) {
    assert.equal(consumeMotionLink({ ...base, ...override }, history), null);
  }
  assert.equal(calls.length, 0);
  assert.equal(consumeMotionLink(base, history), token);
  assert.deepEqual(calls, [[history.state, "", "/"]]);
});

test("explicit Start sends the pairing code only to loopback and shared readings stay signed", async t => {
  const { calls, client } = setup(t);
  assert.equal(client.degrees(), null);
  assert.equal(calls.length, 0);
  client.start(code, "mac", "ignore");
  assert.deepEqual(calls[0].command, { action: "start", source: "mac" });
  calls[0].reply(owned);
  await tick();
  assert.equal(client.degrees(), -17.5);
  t.mock.timers.tick(200);
  client.center(); // Queued behind this in-flight status request.
  assert.equal(calls.length, 2);
  calls[1].reply({ ...owned, degrees: 7 });
  await tick();
  assert.equal(calls[2].command.action, "center");
  calls[2].reply({ ...owned, degrees: 0 });
  await tick();
  assert.equal(client.degrees(), 0);
  client.stop();
  assert.equal(client.degrees(), null);
  assert.equal(calls.at(-1).options.keepalive, true);
  assert.equal(calls.at(-1).command.action, "stop");
  for (const { url, options } of calls) {
    assert.equal(url, MOTION_URL);
    assert.equal(options.targetAddressSpace, "loopback");
    assert.equal(options.headers.Authorization, "Bearer " + code);
    assert.equal(options.headers["X-Motion-Session"], calls[0].options.headers["X-Motion-Session"]);
    assert.ok(!options.body.includes(code));
    assert.equal(options.redirect, "error");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
  }
  calls.at(-1).reply(stopped);
});

test("slow and foreign sessions cannot publish readings or overlap polls", async t => {
  const { calls, client } = setup(t);
  client.start(code, "iphone", "invalid");
  assert.equal(calls.length, 0);
  client.start(code, "iphone", "192.168.1.11");
  assert.deepEqual(calls[0].command, { action: "start", source: "iphone", phone: "192.168.1.11" });
  calls[0].reply(owned);
  await tick();
  t.mock.timers.tick(200);
  t.mock.timers.tick(560);
  assert.equal(calls.length, 2);
  assert.equal(client.degrees(), null);
  calls[1].reply({ ...owned, owned: false, status: "Another tab is using motion." });
  await tick();
  assert.equal(client.snapshot().phase, "idle");
  assert.equal(client.degrees(), null);
  t.mock.timers.tick(1000);
  assert.equal(calls.length, 2);
});

test("stop while starting clears motion and an old session cannot affect a new start", async t => {
  const { calls, client } = setup(t);
  client.start(code, "mac", "");
  client.stop();
  client.start(code, "mac", "");
  assert.equal(calls[0].options.signal.aborted, true);
  assert.notEqual(calls[0].options.headers["X-Motion-Session"], calls[2].options.headers["X-Motion-Session"]);
  calls[0].reply(owned);
  calls[1].reply(stopped);
  calls[2].reply({ ...owned, degrees: 42 });
  await tick();
  assert.equal(client.degrees(), 42);
});

test("a transient status failure clears the angle and retries; invalid responses stay out of mappings", async t => {
  const { calls, client } = setup(t);
  client.start(code, "mac", "");
  calls[0].reply(owned);
  await tick();
  t.mock.timers.tick(200);
  calls[1].fail(new Error("network interrupted"));
  await tick();
  assert.equal(client.degrees(), null);
  t.mock.timers.tick(200);
  calls[2].reply({ ...owned, degrees: -181 });
  await tick();
  assert.equal(client.snapshot().phase, "error");
  assert.equal(client.degrees(), null);
  assert.equal(calls.at(-1).command.action, "stop");
});

test("a user launch generates one nonce, survives cold-start races and starts the requested source", async t => {
  const launches = [];
  const { calls, client } = setup(t, url => {
    assert.equal(calls.length, 0, "dispatch the app URL on the click before fetching");
    launches.push(url);
  });
  assert.equal(launches.length, 0);
  client.startNative("iphone", "invalid");
  assert.equal(launches.length, 0);
  client.startNative("iphone", "192.168.1.20");
  const match = /^bodysynth-motion:\/\/connect\/([0-9a-f]{64})$/.exec(launches[0]);
  assert.ok(match);
  client.startNative();
  assert.equal(launches.length, 1);
  calls[0].fail(new TypeError("connection refused"));
  await tick();
  t.mock.timers.tick(500);
  calls[1].reply({}, 401);
  await tick();
  assert.equal(client.snapshot().phase, "starting");
  t.mock.timers.tick(1000);
  assert.equal(launches.length, 1);
  assert.equal(calls.length, 3);
  for (const { url, command, options } of calls) {
    assert.equal(url, MOTION_URL);
    assert.deepEqual(command, { action: "start", source: "iphone", phone: "192.168.1.20" });
    assert.equal(options.headers.Authorization, "Bearer " + match[1]);
    assert.equal(options.headers["X-Motion-Session"], calls[0].options.headers["X-Motion-Session"]);
  }
  calls[2].reply(owned);
  await tick();
  assert.equal(client.degrees(), -17.5);
  t.mock.timers.tick(200);
  assert.equal(calls.at(-1).command.action, "status");
});

test("cancelling a launch drops its retries, and a new click uses a fresh capability", async t => {
  const launches = [];
  const { calls, client } = setup(t, url => launches.push(url));
  client.startNative();
  calls[0].reply({}, 401);
  await tick();
  client.stop();
  calls[1].reply(stopped);
  t.mock.timers.tick(4000);
  assert.equal(calls.length, 2);
  assert.equal(client.snapshot().phase, "idle");
  client.startNative();
  assert.notEqual(launches[0], launches[1]);
  assert.notEqual(calls[0].options.headers["X-Motion-Session"], calls[2].options.headers["X-Motion-Session"]);
  assert.deepEqual(calls[2].command, { action: "start", source: "mac" });
  calls[2].reply({ error: "Another tab is using motion." }, 409);
  await tick();
  assert.equal(client.snapshot().status, "Another tab is using motion.");
  assert.equal(calls.at(-1).command.action, "stop");
  t.mock.timers.tick(4000);
  assert.equal(calls.length, 4);
});

test("a missing companion stops retrying and presents installation help", async t => {
  const { calls, client } = setup(t, () => {});
  client.startNative();
  for (let count = 0; count < 40 && client.snapshot().phase === "starting"; count++) {
    calls.at(-1).fail(new TypeError("connection refused"));
    await tick();
    t.mock.timers.tick(1500);
  }
  assert.equal(client.snapshot().phase, "error");
  assert.match(client.snapshot().status, /installed on this Mac/);
  assert.ok(!client.snapshot().status.includes(calls[0].options.headers.Authorization.slice(7)));
  const done = calls.length;
  t.mock.timers.tick(60_000);
  assert.equal(calls.length, done);
});

test("an explicit manual pairing keeps its immediate authentication feedback", async t => {
  const { calls, client } = setup(t, () => assert.fail("manual pairing must not dispatch an app URL"));
  client.start(code, "mac", "");
  calls[0].reply({}, 401);
  await tick();
  assert.equal(client.snapshot().phase, "error");
  assert.match(client.snapshot().status, /pairing code/);
  t.mock.timers.tick(1000);
  assert.equal(calls.filter(call => call.command.action === "start").length, 1);
});
