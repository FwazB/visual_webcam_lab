"""Protocol/security regression tests; no TouchDesigner installation required."""

import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bridge_callbacks as bridge


class Parameter:
    def __init__(self, value=0):
        self.val = value

    def eval(self):
        return self.val


class Parameters:
    def __init__(self):
        self.value0 = Parameter()
        self.value1 = Parameter()
        self.value2 = Parameter()

    def __setattr__(self, name, value):
        if name in self.__dict__:
            self.__dict__[name].val = value
        else:
            super().__setattr__(name, value)


class Storage:
    def __init__(self):
        self.storage = {}
        self.startup = {}

    def fetch(self, key, default=None, storeDefault=False):
        if storeDefault and key not in self.storage:
            self.storage[key] = default
        return self.storage.get(key, default)

    def store(self, key, value):
        self.storage[key] = value

    def storeStartupValue(self, key, value):
        self.startup[key] = value


class Parent(Storage):
    def __init__(self):
        super().__init__()
        self.nodes = {name: SimpleNamespace(par=Parameters()) for name in ("CHORD", "CONTROLS")}
        self.store("pairingCode", "test-only-pairing-code")

    def op(self, name):
        return self.nodes[name]


class Server(Storage):
    def __init__(self):
        super().__init__()
        self.base = Parent()
        self.sent, self.closed = [], []
        self.par = Parameters()
        self.par.localaddress = Parameter("127.0.0.1")
        self.par.active = Parameter(False)

    def parent(self):
        return self.base

    def webSocketSendText(self, client, message):
        self.sent.append((client, json.loads(message)))

    def webSocketClose(self, client):
        self.closed.append(client)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.server = Server()
        bridge.onWebSocketOpen(self.server, "client", "/body-synth")

    def send(self, message, client="client"):
        bridge.onWebSocketReceiveText(self.server, client, json.dumps(message))

    def pair(self, client="client", **overrides):
        self.send({"type": "hello", "protocolVersion": 1, "clientId": "test-client",
                   "pairingCode": "test-only-pairing-code", **overrides}, client)

    def test_pairing_has_welcome_then_complete_snapshot(self):
        self.pair()
        messages = [message for _, message in self.server.sent]
        self.assertEqual([message["type"] for message in messages], ["welcome", "state.snapshot"])
        self.assertEqual(messages[0]["capabilities"]["parameters"], list(bridge.DEFAULT_PARAMETERS))
        self.assertEqual(messages[1]["state"]["parameters"], bridge.DEFAULT_PARAMETERS)
        self.assertFalse(messages[1]["state"]["running"])

    def test_unknown_path_closed_without_state(self):
        bridge.onWebSocketOpen(self.server, "other", "/")
        self.assertIn("other", self.server.closed)
        self.assertNotIn("other", bridge._clients(self.server))

    def test_commands_before_pairing_never_mutate(self):
        self.send({"type": "parameter.set", "parameter": "output.blackout", "value": True})
        self.assertEqual(self.server.sent[-1][1]["code"], "authentication")
        self.assertFalse(bridge._state(self.server)["parameters"]["output.blackout"])
        self.assertIn("client", self.server.closed)

    def test_bad_pairing_and_version_closed(self):
        for overrides in ({"pairingCode": "wrong"}, {"pairingCode": "\ud800"},
                          {"protocolVersion": 2}, {"protocolVersion": True}):
            with self.subTest(overrides=overrides):
                bridge.onWebSocketOpen(self.server, "client", "/body-synth")
                self.pair(**overrides)
                self.assertIn("client", self.server.closed)
                self.assertFalse(bridge._clients(self.server).get("client", False))

    def test_malformed_messages_do_not_raise_or_mutate(self):
        self.pair()
        for raw in ("null", "[]", "1", '"text"', "{", "[" * 1500 + "]" * 1500):
            bridge.onWebSocketReceiveText(self.server, "client", raw)
            self.assertEqual(self.server.sent[-1][1]["code"], "invalid_message")
        self.assertEqual(bridge._state(self.server)["revision"], 0)

    def test_oversized_and_invalid_unicode_closed(self):
        for raw in (" " * 8193, "\ud800"):
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
            bridge.onWebSocketReceiveText(self.server, "client", raw)
            self.assertIn("client", self.server.closed)

    def test_parameter_allowlist_ranges_and_types(self):
        self.pair()
        invalid = [("visual.fuzz.amount", -1), ("visual.fuzz.amount", True),
                   ("visual.fuzz.amount", float("nan")), ("visual.fuzz.amount", float("inf")),
                   ("visual.fuzz.amount", 10 ** 400), ("visual.fuzz.feedback", 1),
                   ("output.blackout", 1), ("/project1/private", 1), ([], 1)]
        for parameter, value in invalid:
            self.send({"type": "parameter.set", "parameter": parameter, "value": value})
            self.assertEqual(self.server.sent[-1][1]["type"], "error")
        self.assertEqual(bridge._state(self.server)["revision"], 0)

    def test_parameters_write_controls_and_broadcast_snapshots(self):
        self.pair()
        bridge.onWebSocketOpen(self.server, "second", "/body-synth")
        self.pair("second")
        self.send({"type": "parameter.set", "parameter": "output.blackout", "value": True})
        self.assertTrue(self.server.base.op("CONTROLS").par.value2.eval())
        self.assertEqual([client for client, _ in self.server.sent[-2:]], ["client", "second"])
        self.assertEqual(self.server.sent[-1][1]["state"]["revision"], 1)

    def test_ping_echoes_finite_timestamp(self):
        self.pair()
        self.send({"type": "ping", "sentAt": 123.5})
        self.assertEqual(self.server.sent[-1][1]["sentAt"], 123.5)
        self.assertIsInstance(self.server.sent[-1][1]["receivedAt"], float)
        self.send({"type": "ping", "sentAt": True})
        self.assertEqual(self.server.sent[-1][1]["type"], "error")

    def test_event_validation_and_chord_mapping(self):
        self.pair()
        for payload in ([], "bad", None, {"chordId": []}, {"chordId": "unknown"}):
            self.send({"type": "event", "name": "song.chord", "payload": payload})
            self.assertEqual(self.server.sent[-1][1]["type"], "error")
        self.send({"type": "event", "name": "song.chord", "payload": {"chordId": "gm"}})
        self.assertEqual(self.server.base.op("CHORD").par.value0.eval(), 2)

    def test_hit_pulse_decays_without_more_messages(self):
        self.pair()
        with patch.object(bridge.time, "monotonic", return_value=10):
            self.send({"type": "event", "name": "note.hit", "payload": {"chordTone": True, "strength": 0.8}})
            self.assertAlmostEqual(bridge.hit_level(self.server), 0.8)
        with patch.object(bridge.time, "monotonic", return_value=10.125):
            self.assertAlmostEqual(bridge.hit_level(self.server), 0.4)
        with patch.object(bridge.time, "monotonic", return_value=10.5):
            self.assertEqual(bridge.hit_level(self.server), 0)

    def test_stop_and_disconnect_clear_hits(self):
        self.pair()
        self.send({"type": "transport.set", "playing": True})
        self.send({"type": "event", "name": "note.hit", "payload": {"chordTone": True, "strength": 1}})
        self.send({"type": "transport.set", "playing": False})
        self.assertEqual(self.server.base.op("CHORD").par.value1.eval(), 0)
        self.send({"type": "transport.set", "playing": True})
        bridge.onWebSocketClose(self.server, "client")
        self.assertFalse(bridge._state(self.server)["running"])

    def test_server_restart_drops_saved_authentication_and_transport(self):
        self.pair()
        self.send({"type": "transport.set", "playing": True})
        self.send({"type": "event", "name": "note.hit", "payload": {"chordTone": True, "strength": 1}})
        self.send({"type": "parameter.set", "parameter": "visual.fuzz.amount", "value": 0.7})
        bridge.onServerStart(self.server)
        self.assertEqual(bridge._clients(self.server), {})
        self.assertFalse(bridge._state(self.server)["running"])
        self.assertEqual(self.server.base.op("CHORD").par.value1.eval(), 0)
        self.assertEqual(bridge._state(self.server)["parameters"]["visual.fuzz.amount"], 0.7)

    def test_export_clears_only_known_runtime_values_and_stops_listener(self):
        self.pair()
        self.server.base.store("unrelatedUserSetting", "preserve")
        self.send({"type": "transport.set", "playing": True})
        self.send({"type": "event", "name": "note.hit", "payload": {"chordTone": True, "strength": 1}})
        self.send({"type": "parameter.set", "parameter": "visual.fuzz.amount", "value": 0.7})
        bridge.prepare_for_export(self.server)
        self.assertIsNone(self.server.base.fetch("pairingCode"))
        self.assertIsNone(self.server.base.startup["pairingCode"])
        self.assertEqual(self.server.startup["fuzzClients"], {})
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(self.server.base.fetch("lastHitAt"), -1000)
        self.assertEqual(self.server.base.op("CHORD").par.value1.eval(), 0)
        self.assertFalse(self.server.par.active.eval())
        self.assertEqual(bridge._state(self.server)["revision"], 0)
        self.assertIsNone(bridge._state(self.server)["sessionId"])
        self.assertFalse(bridge._state(self.server)["running"])
        self.assertEqual(bridge._state(self.server)["parameters"]["visual.fuzz.amount"], 0.7)
        self.assertEqual(self.server.base.fetch("unrelatedUserSetting"), "preserve")

    def test_open_generates_runtime_code_and_saves_only_blank_startup_value(self):
        bridge.prepare_for_export(self.server)
        with patch.object(bridge.secrets, "token_urlsafe", return_value="new-runtime-code") as generate:
            bridge.start_bridge(self.server)
            generate.assert_called_once_with(24)
        self.assertEqual(self.server.base.fetch("pairingCode"), "new-runtime-code")
        self.assertIsNone(self.server.base.startup["pairingCode"])
        self.assertTrue(self.server.par.active.eval())
        with patch.object(bridge.secrets, "token_urlsafe") as generate:
            bridge.onServerStart(self.server)
            generate.assert_not_called()

    def test_unsupported_build_cannot_start_listener(self):
        del self.server.par.localaddress
        self.server.base.store("pairingCode", None)
        with self.assertRaisesRegex(RuntimeError, "2025.33070"):
            bridge.start_bridge(self.server)
        self.assertFalse(self.server.par.active.eval())
        self.assertIsNone(self.server.base.fetch("pairingCode"))

    def test_start_binds_loopback_and_native_start_rejects_public_bind(self):
        self.server.par.localaddress = "0.0.0.0"
        bridge.start_bridge(self.server)
        self.assertEqual(self.server.par.localaddress.eval(), "127.0.0.1")
        self.assertTrue(self.server.par.active.eval())
        self.server.par.localaddress = "0.0.0.0"
        with self.assertRaisesRegex(RuntimeError, "127.0.0.1"):
            bridge.onServerStart(self.server)
        self.assertFalse(self.server.par.active.eval())
        self.assertEqual(bridge._clients(self.server), {})


if __name__ == "__main__":
    unittest.main()
