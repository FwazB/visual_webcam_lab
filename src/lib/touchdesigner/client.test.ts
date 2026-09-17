import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONNECTION_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MAX_BUFFERED_BYTES,
  TOUCHDESIGNER_URL,
  TouchDesignerClient,
  type BridgeSocket,
} from "./client";

const PAIRING_CODE = "test-code-12345";
const welcome = {
  type: "welcome", protocolVersion: 1, engineVersion: "fuzz-1",
  capabilities: {
    modules: ["visuals", "output"], scenes: ["fuzz"], audioPresets: [],
    parameters: ["visual.fuzz.amount", "visual.fuzz.feedback", "output.blackout"],
    cameraDevices: [], audioDevices: [], outputDisplays: [],
  },
};
const snapshot = {
  type: "state.snapshot",
  state: {
    revision: 0, running: false, sessionId: null,
    parameters: { "visual.fuzz.amount": 0.4, "visual.fuzz.feedback": 0.92, "output.blackout": false },
  },
};

class FakeSocket implements BridgeSocket {
  readyState = 0;
  bufferedAmount = 0;
  onopen: BridgeSocket["onopen"] = null;
  onmessage: BridgeSocket["onmessage"] = null;
  onerror: BridgeSocket["onerror"] = null;
  onclose: BridgeSocket["onclose"] = null;
  messages: Record<string, unknown>[] = [];
  closed = false;
  closeCode: number | undefined;
  closeReason: string | undefined;
  throwOnSend = false;
  send(raw: string) {
    if (this.throwOnSend) throw Error("do not reflect this error");
    this.messages.push(JSON.parse(raw));
  }
  close(code?: number, reason?: string) {
    this.closeCode = code;
    this.closeReason = reason;
    this.closed = true;
    this.readyState = 3;
  }
  open() { this.readyState = 1; this.onopen?.({} as Event); }
  receive(message: unknown) { this.raw(JSON.stringify(message)); }
  raw(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

function setup() {
  let now = 1000;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const sockets: FakeSocket[] = [];
  const client = new TouchDesignerClient({
    createSocket: (url) => {
      assert.equal(url, TOUCHDESIGNER_URL);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    now: () => now,
    schedule: (callback, delay) => {
      timers.set(++id, { at: now + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => { timers.delete(timer as unknown as number); },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  };
  const ready = () => {
    client.connect(PAIRING_CODE);
    const socket = sockets[sockets.length - 1];
    socket.open();
    socket.receive(welcome);
    socket.receive(snapshot);
    return socket;
  };
  return { client, sockets, timers, advance, ready };
}

test("stays disconnected until explicit pairing; requires welcome and complete snapshot", () => {
  const { client, sockets } = setup();
  assert.equal(sockets.length, 0);
  assert.equal(client.sendChord("gm"), false);
  client.connect(PAIRING_CODE);
  assert.equal(client.getSnapshot().status, "connecting");
  const socket = sockets[0];
  socket.open();
  assert.deepEqual(socket.messages[0], {
    type: "hello", protocolVersion: 1, clientId: socket.messages[0].clientId, pairingCode: PAIRING_CODE,
  });
  assert.equal(typeof socket.messages[0].clientId, "string");
  assert.equal(socket.onopen, null);
  assert.equal(client.getSnapshot().status, "handshaking");
  socket.receive(welcome);
  assert.equal(client.getSnapshot().status, "handshaking");
  assert.equal(client.setPlaying(true), false);
  socket.receive(snapshot);
  assert.equal(client.getSnapshot().status, "ready");
  assert.deepEqual(client.getSnapshot().state, snapshot.state);
  client.disconnect();
});

test("rejects invalid pairing codes without making a connection", () => {
  const { client, sockets } = setup();
  for (const code of ["", "123", " aaaaaaaa", "a".repeat(129), "aaaa\naaaa"]) {
    client.connect(code);
    assert.equal(client.getSnapshot().status, "error");
  }
  assert.equal(sockets.length, 0);
});

test("constructor failures do not expose raw errors or retry", () => {
  let attempts = 0;
  const client = new TouchDesignerClient({ createSocket: () => { attempts++; throw Error(PAIRING_CODE); } });
  client.connect(PAIRING_CODE);
  assert.equal(client.getSnapshot().status, "error");
  assert.equal(attempts, 1);
  assert.ok(!client.getSnapshot().error?.includes(PAIRING_CODE));
});

test("default timers preserve the browser global receiver through pairing and disconnect", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const activeTimers = new Set<ReturnType<typeof setTimeout>>();
  let scheduled = 0;
  let cancelled = 0;
  globalThis.setTimeout = function (this: unknown, ...args: Parameters<typeof setTimeout>) {
    assert.equal(this, globalThis, "browser setTimeout requires the global receiver");
    scheduled++;
    const timer = originalSetTimeout(...args);
    activeTimers.add(timer);
    return timer;
  } as typeof setTimeout;
  globalThis.clearTimeout = function (this: unknown, ...args: Parameters<typeof clearTimeout>) {
    assert.equal(this, globalThis, "browser clearTimeout requires the global receiver");
    cancelled++;
    activeTimers.delete(args[0] as ReturnType<typeof setTimeout>);
    originalClearTimeout(...args);
  };
  const socket = new FakeSocket();
  const client = new TouchDesignerClient({ createSocket: () => socket });
  try {
    client.connect(PAIRING_CODE);
    socket.open();
    socket.receive(welcome);
    socket.receive(snapshot);
    assert.equal(client.getSnapshot().status, "ready");
    assert.equal(scheduled, 3, "schedules socket opening, handshake and heartbeat");
    client.disconnect();
    assert.equal(cancelled, 3, "cancels socket opening, handshake and heartbeat");
    assert.equal(activeTimers.size, 0);
    assert.equal(socket.closed, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const timer of activeTimers) originalClearTimeout(timer);
    client.disconnect();
  }
});

test("socket opening allows time for local-network permission and expires without retry", () => {
  const { client, sockets, timers, advance } = setup();
  client.connect(PAIRING_CODE);
  advance(HANDSHAKE_TIMEOUT_MS * 2);
  assert.equal(client.getSnapshot().status, "connecting");
  assert.equal(sockets[0].messages.length, 0);
  advance(CONNECTION_TIMEOUT_MS - HANDSHAKE_TIMEOUT_MS * 2 - 1);
  assert.equal(client.getSnapshot().status, "connecting");
  advance(1);
  assert.equal(client.getSnapshot().status, "error");
  assert.match(client.getSnapshot().error!, /Allow local network access/);
  assert.equal(sockets[0].closed, true);
  assert.equal(timers.size, 0);
  advance(CONNECTION_TIMEOUT_MS);
  assert.equal(sockets.length, 1);
});

test("late socket opening starts a fresh five-second handshake deadline", () => {
  const { client, sockets, timers, advance } = setup();
  client.connect(PAIRING_CODE);
  advance(CONNECTION_TIMEOUT_MS - 1_000);
  sockets[0].open();
  sockets[0].receive(welcome);
  advance(HANDSHAKE_TIMEOUT_MS - 1);
  assert.equal(client.getSnapshot().status, "handshaking");
  advance(1);
  assert.equal(client.getSnapshot().status, "error");
  assert.match(client.getSnapshot().error!, /did not finish pairing/);
  assert.equal(sockets[0].closed, true);
  assert.equal(timers.size, 0);
  advance(CONNECTION_TIMEOUT_MS);
  assert.equal(sockets.length, 1);
});

test("disconnect cancels both socket-opening and handshake deadlines", () => {
  for (const opened of [false, true]) {
    const { client, sockets, timers, advance } = setup();
    client.connect(PAIRING_CODE);
    if (opened) sockets[0].open();
    client.disconnect();
    assert.equal(timers.size, 0);
    advance(CONNECTION_TIMEOUT_MS + HANDSHAKE_TIMEOUT_MS);
    assert.equal(client.getSnapshot().status, "disconnected");
    assert.equal(sockets[0].closed, true);
    assert.equal(sockets.length, 1);
  }
});

test("rejects incompatible, incomplete and out-of-order handshakes", () => {
  for (const messages of [
    [{ ...welcome, protocolVersion: 2 }],
    [{ ...welcome, engineVersion: "other" }],
    [{ ...welcome, capabilities: { ...welcome.capabilities, scenes: [] } }],
    [{ ...welcome, capabilities: { ...welcome.capabilities, parameters: [] } }],
    [snapshot],
    [welcome, { ...snapshot, state: { ...snapshot.state, parameters: {} } }],
    [welcome, welcome],
    [{ type: "pong", sentAt: 1, receivedAt: 1 }],
  ]) {
    const { client, sockets } = setup();
    client.connect(PAIRING_CODE);
    sockets[0].open();
    messages.forEach((message) => sockets[0].receive(message));
    assert.equal(client.getSnapshot().status, "error");
    assert.equal(sockets[0].closed, true);
  }
});

test("transmits only validated control events and never updates parameters optimistically", () => {
  const { client, ready } = setup();
  const socket = ready();
  const sent = socket.messages.length;
  assert.equal(client.sendChord("c9sus4"), true);
  assert.equal(client.sendNoteHit(true, 0.75), true);
  assert.equal(client.setPlaying(true), true);
  assert.equal(client.setParameter("visual.fuzz.amount", 0.8), true);
  assert.equal(client.setParameter("output.blackout", true), true);
  assert.deepEqual(socket.messages.slice(sent), [
    { type: "event", name: "song.chord", payload: { chordId: "c9sus4" } },
    { type: "event", name: "note.hit", payload: { chordTone: true, strength: 0.75 } },
    { type: "transport.set", playing: true },
    { type: "parameter.set", parameter: "visual.fuzz.amount", value: 0.8 },
    { type: "parameter.set", parameter: "output.blackout", value: true },
  ]);
  assert.equal(client.getSnapshot().state?.parameters["visual.fuzz.amount"], 0.4);
  const beforeInvalid = socket.messages.length;
  assert.equal(client.sendNoteHit(true, NaN), false);
  assert.equal(client.sendNoteHit(true, 1.1), false);
  assert.equal(client.setParameter("visual.fuzz.feedback", 0.99), false);
  assert.equal(client.setParameter("visual.fuzz.amount", false), false);
  assert.equal(client.setParameter("output.blackout", 1), false);
  assert.equal(socket.messages.length, beforeInvalid);
  client.disconnect();
});

test("merges contiguous state patches and ignores already applied revisions", () => {
  const { client, ready } = setup();
  const socket = ready();
  socket.receive({ type: "state.patch", revision: 1, changes: { parameters: { "visual.fuzz.amount": 0.8 } } });
  assert.equal(client.getSnapshot().state?.revision, 1);
  assert.equal(client.getSnapshot().state?.parameters["visual.fuzz.amount"], 0.8);
  assert.equal(client.getSnapshot().state?.parameters["visual.fuzz.feedback"], 0.92);
  socket.receive({ type: "state.patch", revision: 1, changes: { running: true } });
  assert.equal(client.getSnapshot().state?.running, false);
  socket.receive({ type: "state.patch", revision: 3, changes: { running: true } });
  assert.equal(client.getSnapshot().status, "error");
});

test("heartbeat needs matching pongs; unrelated messages cannot hide a stale engine", () => {
  const { client, ready, advance, timers } = setup();
  const socket = ready();
  const ping = socket.messages.at(-1)!;
  assert.equal(ping.type, "ping");
  advance(HEARTBEAT_INTERVAL_MS);
  socket.receive({ type: "pong", sentAt: ping.sentAt, receivedAt: ping.sentAt });
  advance(HEARTBEAT_INTERVAL_MS);
  assert.equal(client.getSnapshot().status, "ready");
  socket.receive({ type: "pong", sentAt: 1, receivedAt: 1 });
  socket.receive({ type: "event", name: "still.here" });
  advance(HEARTBEAT_TIMEOUT_MS - HEARTBEAT_INTERVAL_MS);
  assert.equal(client.getSnapshot().status, "error");
  assert.equal(timers.size, 0);
  assert.equal(socket.closed, true);
});

test("disconnect cancels timers and listeners; explicit reconnect cannot receive old socket data", () => {
  const { client, ready, sockets, timers, advance } = setup();
  let updates = 0;
  const unsubscribe = client.subscribe(() => { updates++; });
  const socket = ready();
  const lateMessage = socket.onmessage!;
  const lateError = socket.onerror!;
  assert.ok(updates > 0);
  client.disconnect();
  assert.equal(client.getSnapshot().status, "disconnected");
  assert.equal(client.getSnapshot().state, null);
  assert.equal(socket.closed, true);
  assert.equal(socket.closeCode, 1000);
  assert.equal(socket.closeReason, "disconnect");
  assert.equal(socket.onmessage, null);
  assert.equal(timers.size, 0);
  unsubscribe();
  const previousUpdates = updates;
  ready();
  lateMessage({ data: "broken" } as MessageEvent);
  lateError({} as Event);
  assert.equal(client.getSnapshot().status, "ready");
  assert.equal(updates, previousUpdates);
  assert.equal(sockets.length, 2);
  client.disconnect();
  advance(60_000);
  assert.equal(sockets.length, 2);
});

test("malformed, binary and oversized responses close the connection", () => {
  for (const raw of ["{", new Uint8Array([1]), "x".repeat(16_385), '{"type":"state.patch","revision":1,"changes":{"running":"yes"}}']) {
    const { client, ready } = setup();
    const socket = ready();
    socket.raw(raw);
    assert.equal(client.getSnapshot().status, "error");
    assert.equal(socket.closed, true);
  }
});

test("send failure and backpressure close cleanly without queuing or exposing errors", () => {
  for (const mode of ["throw", "buffer", "closed"]) {
    const { client, ready, timers } = setup();
    const socket = ready();
    if (mode === "throw") socket.throwOnSend = true;
    if (mode === "buffer") socket.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    if (mode === "closed") socket.readyState = 3;
    assert.equal(client.sendNoteHit(false), false);
    assert.equal(client.getSnapshot().status, "error");
    assert.equal(socket.closed, true);
    assert.equal(timers.size, 0);
    assert.ok(!client.getSnapshot().error?.includes("do not reflect"));
  }
});

test("server errors never reflect potentially sensitive message contents", () => {
  const { client, ready } = setup();
  const socket = ready();
  socket.receive({ type: "error", code: "bad_command", message: PAIRING_CODE, recoverable: true });
  assert.equal(client.getSnapshot().status, "ready");
  assert.ok(client.getSnapshot().error);
  assert.ok(!client.getSnapshot().error?.includes(PAIRING_CODE));
  socket.receive({ type: "error", code: "unauthorized", message: PAIRING_CODE, recoverable: false });
  assert.equal(client.getSnapshot().status, "error");
  assert.ok(!client.getSnapshot().error?.includes(PAIRING_CODE));
});
