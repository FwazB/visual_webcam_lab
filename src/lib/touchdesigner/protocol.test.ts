import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ENGINE_MESSAGE_LENGTH, parseEngineMessage } from "./protocol";

const capabilities = {
  modules: ["visuals", "output"], scenes: ["fuzz"], audioPresets: [],
  parameters: ["visual.fuzz.amount", "visual.fuzz.feedback", "output.blackout"],
  cameraDevices: [], audioDevices: [], outputDisplays: [],
};
const state = {
  revision: 0, running: false, sessionId: null,
  parameters: { "visual.fuzz.amount": 0.4, "visual.fuzz.feedback": 0.92, "output.blackout": false },
};
const validMessages = [
  { type: "welcome", protocolVersion: 1, engineVersion: "fuzz-1", capabilities },
  { type: "state.snapshot", state },
  { type: "state.patch", revision: 1, changes: { parameters: { "visual.fuzz.amount": 0.8 } } },
  { type: "telemetry.frame", telemetry: { fps: 60, cookMs: 8, audioLevel: 0.2, bodyConfidence: 0, trackedHands: 0, droppedFrames: 1 } },
  { type: "event", name: "cue.fired", payload: { cueId: "fuzz", value: true } },
  { type: "error", code: "bad_command", message: "Unsupported command", recoverable: true },
  { type: "pong", sentAt: 1000, receivedAt: 1001 },
];

for (const message of validMessages) {
  test(`validates ${message.type}`, () => {
    assert.deepEqual(parseEngineMessage(JSON.stringify(message)), message);
  });
}

test("rejects malformed, oversized, unknown and non-record messages", () => {
  for (const raw of ["{", "null", "[]", '"welcome"', '{"type":"wat"}', " ".repeat(MAX_ENGINE_MESSAGE_LENGTH + 1)]) {
    assert.equal(parseEngineMessage(raw), null);
  }
});

test("rejects malformed fields in every engine message family", () => {
  const invalid = [
    { ...validMessages[0], protocolVersion: "1" },
    { ...validMessages[0], capabilities: { ...capabilities, modules: ["shell"] } },
    { ...validMessages[0], capabilities: { ...capabilities, parameters: ["/project1/eval"] } },
    { ...validMessages[0], capabilities: { ...capabilities, scenes: ["fuzz", "fuzz"] } },
    { type: "welcome", protocolVersion: 1, engineVersion: "fuzz-1", capabilities: {} },
    { type: "state.snapshot", state: { ...state, running: "yes" } },
    { type: "state.snapshot", state: { ...state, revision: -1 } },
    { type: "state.snapshot", state: { ...state, revision: 0.1 } },
    { type: "state.snapshot", state: { ...state, parameters: { "visual.fuzz.amount": "0.2" } } },
    { type: "state.snapshot", state: { ...state, parameters: { "visual.fuzz.feedback": 0.99 } } },
    { type: "state.snapshot", state: { ...state, parameters: { "output.blackout": 1 } } },
    { type: "state.snapshot", state: { ...state, parameters: { "visual.fuzz.amount": null } } },
    { type: "state.patch", revision: 1, changes: { revision: 2 } },
    { type: "state.patch", revision: 1, changes: { parameters: [] } },
    { type: "state.patch", revision: 1, changes: { unexpected: true } },
    { type: "telemetry.frame", telemetry: { fps: 60 } },
    { type: "event", name: "bad", payload: { nested: { command: "eval" } } },
    { type: "event", name: "bad", payload: { items: [] } },
    { type: "error", code: "bad", message: "bad", recoverable: "true" },
    { type: "pong", sentAt: -1, receivedAt: 1 },
    { type: "pong", sentAt: 1, receivedAt: "1" },
    { ...validMessages[6], requestId: 42 },
  ];
  for (const message of invalid) assert.equal(parseEngineMessage(JSON.stringify(message)), null, JSON.stringify(message));
  assert.equal(parseEngineMessage('{"type":"event","name":"bad","payload":{"__proto__":null}}'), null);
  assert.equal(parseEngineMessage('{"type":"pong","sentAt":1e309,"receivedAt":1}'), null);
});
