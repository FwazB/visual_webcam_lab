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


class ScheduledRun:
    def __init__(self, callback, args, options):
        self.callback, self.args, self.options = callback, args, options
        self.killed = False

    def kill(self):
        self.killed = True

    def fire(self):
        # Can simulate an obsolete native callback even after cancellation.
        self.callback(*self.args)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.jobs = []
        self.clock = patch.object(bridge.time, "monotonic", return_value=100)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.run_patch = patch.object(bridge, "run", self.schedule, create=True)
        self.run_patch.start()
        self.addCleanup(self.run_patch.stop)
        self.td_resources = object()
        self.op_patch = patch.object(bridge, "op", SimpleNamespace(TDResources=self.td_resources), create=True)
        self.op_patch.start()
        self.addCleanup(self.op_patch.stop)
        self.server = Server()
        self.addCleanup(bridge.onServerStop, self.server)
        bridge.onWebSocketOpen(self.server, "client", "/body-synth")

    def schedule(self, callback, *args, **options):
        job = ScheduledRun(callback, args, options)
        self.jobs.append(job)
        return job

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

    def test_pending_client_flood_is_bounded_with_one_timer(self):
        for index in range(1000):
            bridge.onWebSocketOpen(self.server, "pending-" + str(index), "/body-synth")
        self.assertEqual(len(bridge._clients(self.server)), bridge.MAX_PENDING_CLIENTS)
        self.assertEqual(len(bridge._pending(self.server)), bridge.MAX_PENDING_CLIENTS)
        self.assertEqual(len(self.server.closed), 1001 - bridge.MAX_PENDING_CLIENTS)
        self.assertEqual(len(self.jobs), 1)
        self.assertEqual(bridge._state(self.server)["revision"], 0)

    def test_paired_clients_release_pending_slots_but_total_is_bounded(self):
        self.pair()
        for index in range(1, bridge.MAX_CLIENTS):
            client = "paired-" + str(index)
            bridge.onWebSocketOpen(self.server, client, "/body-synth")
            self.pair(client)
        bridge.onWebSocketOpen(self.server, "overflow", "/body-synth")
        self.assertIn("overflow", self.server.closed)
        self.assertEqual(len(bridge._clients(self.server)), bridge.MAX_CLIENTS)
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)
        self.assertTrue(all(job.killed for job in self.jobs))

    def test_silent_clients_expire_on_wall_clock_without_messages(self):
        job = self.jobs[0]
        self.assertEqual(job.options["delayMilliSeconds"], 5000)
        self.assertTrue(job.options["wallTime"])
        self.assertIs(job.options["delayRef"], self.td_resources)
        with patch.object(bridge.time, "monotonic", return_value=105):
            job.fire()
        self.assertIn("client", self.server.closed)
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)

    def test_early_timer_does_not_close_client_and_rearms_remaining_delay(self):
        with patch.object(bridge.time, "monotonic", return_value=104):
            self.jobs[0].fire()
        self.assertNotIn("client", self.server.closed)
        self.assertEqual(self.jobs[-1].options["delayMilliSeconds"], 1000)
        self.pair()
        self.assertTrue(bridge._clients(self.server)["client"])
        self.assertTrue(self.jobs[-1].killed)

    def test_late_hello_rejected_even_before_native_timer_dispatch(self):
        with patch.object(bridge.time, "monotonic", return_value=105):
            self.pair()
        self.assertNotIn("client", bridge._clients(self.server))
        self.assertFalse(any(message["type"] == "welcome" for _, message in self.server.sent))

    def test_expiry_preserves_paired_clients_and_rearms_for_later_handshake(self):
        with patch.object(bridge.time, "monotonic", return_value=101):
            bridge.onWebSocketOpen(self.server, "paired", "/body-synth")
            self.pair("paired")
            bridge.onWebSocketOpen(self.server, "later", "/body-synth")
        with patch.object(bridge.time, "monotonic", return_value=105):
            self.jobs[0].fire()
        self.assertEqual(bridge._clients(self.server), {"paired": True, "later": False})
        self.assertEqual(self.jobs[-1].options["delayMilliSeconds"], 1000)
        with patch.object(bridge.time, "monotonic", return_value=106):
            self.jobs[-1].fire()
        self.assertEqual(bridge._clients(self.server), {"paired": True})

    def test_duplicate_open_cannot_extend_hello_deadline(self):
        with patch.object(bridge.time, "monotonic", return_value=104):
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
        self.assertEqual(bridge._pending(self.server)["client"], 105)
        self.assertEqual(len(self.jobs), 1)

    def test_expired_connections_free_capacity_before_next_open(self):
        for index in range(bridge.MAX_PENDING_CLIENTS - 1):
            bridge.onWebSocketOpen(self.server, str(index), "/body-synth")
        with patch.object(bridge.time, "monotonic", return_value=105):
            bridge.onWebSocketOpen(self.server, "fresh", "/body-synth")
        self.assertEqual(bridge._clients(self.server), {"fresh": False})
        self.assertEqual(bridge._pending(self.server), {"fresh": 110})

    def test_stale_timer_cannot_close_reused_client_after_restart(self):
        obsolete = self.jobs[0]
        bridge.onServerStart(self.server)
        self.assertTrue(obsolete.killed)
        with patch.object(bridge.time, "monotonic", return_value=110):
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
            obsolete.fire()
        self.assertEqual(bridge._clients(self.server), {"client": False})
        self.assertEqual(bridge._pending(self.server), {"client": 115})
        self.assertIs(bridge._expiry_jobs[self.server][1], self.jobs[-1])

    def test_disconnect_churn_does_not_accumulate_active_timers(self):
        for _ in range(100):
            bridge.onWebSocketClose(self.server, "client")
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
        self.assertEqual(sum(not job.killed for job in self.jobs), 1)
        self.assertEqual(len(bridge._pending(self.server)), 1)

    def test_scheduler_failure_fails_closed(self):
        bridge.onWebSocketClose(self.server, "client")
        with patch.object(bridge, "run", side_effect=RuntimeError("scheduler unavailable")):
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)

    def test_native_close_failure_stops_listener_and_clears_all_pending(self):
        bridge.onWebSocketOpen(self.server, "second", "/body-synth")
        self.server.par.active = True
        with patch.object(self.server, "webSocketClose", side_effect=RuntimeError("native close failed")):
            with patch.object(bridge.time, "monotonic", return_value=105):
                self.jobs[0].fire()
        self.assertFalse(self.server.par.active.eval())
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)

    def test_native_close_failure_rejecting_overflow_stops_listener(self):
        for index in range(bridge.MAX_PENDING_CLIENTS - 1):
            bridge.onWebSocketOpen(self.server, str(index), "/body-synth")
        self.server.par.active = True
        with patch.object(self.server, "webSocketClose", side_effect=RuntimeError("native close failed")):
            bridge.onWebSocketOpen(self.server, "overflow", "/body-synth")
        self.assertFalse(self.server.par.active.eval())
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)

    def test_scheduler_and_native_close_failure_still_clear_pending(self):
        bridge.onWebSocketClose(self.server, "client")
        self.server.par.active = True
        with patch.object(bridge, "run", side_effect=RuntimeError("scheduler unavailable")):
            with patch.object(self.server, "webSocketClose", side_effect=RuntimeError("native close failed")):
                bridge.onWebSocketOpen(self.server, "client", "/body-synth")
        self.assertFalse(self.server.par.active.eval())
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)

    def test_native_cancel_failure_cannot_keep_or_revive_pending_state(self):
        obsolete = self.jobs[0]
        with patch.object(obsolete, "kill", side_effect=RuntimeError("run already finished")):
            bridge.onServerStop(self.server)
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        with patch.object(bridge.time, "monotonic", return_value=110):
            bridge.onWebSocketOpen(self.server, "client", "/body-synth")
            obsolete.fire()
        self.assertEqual(bridge._pending(self.server), {"client": 115})
        self.assertIs(bridge._expiry_jobs[self.server][1], self.jobs[-1])

    def test_malformed_preauth_messages_close_and_release_pending_slot(self):
        for raw in ("null", "[]", "1", '"text"', "{", "{}", '{"type":null}', "[" * 1500 + "]" * 1500):
            with self.subTest(raw=raw[:20]):
                bridge.onWebSocketOpen(self.server, "client", "/body-synth")
                bridge.onWebSocketReceiveText(self.server, "client", raw)
                self.assertEqual(self.server.sent[-1][1]["code"], "invalid_message")
                self.assertFalse(self.server.sent[-1][1]["recoverable"])
                self.assertNotIn("client", bridge._clients(self.server))
                self.assertEqual(bridge._pending(self.server), {})
                self.assertNotIn(self.server, bridge._expiry_jobs)
        self.assertEqual(bridge._state(self.server)["revision"], 0)

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
            self.assertTrue(self.server.sent[-1][1]["recoverable"])
        self.assertEqual(bridge._state(self.server)["revision"], 0)
        self.assertTrue(bridge._clients(self.server)["client"])

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
        bridge.onWebSocketOpen(self.server, "pending", "/body-synth")
        self.server.base.store("unrelatedUserSetting", "preserve")
        self.send({"type": "transport.set", "playing": True})
        self.send({"type": "event", "name": "note.hit", "payload": {"chordTone": True, "strength": 1}})
        self.send({"type": "parameter.set", "parameter": "visual.fuzz.amount", "value": 0.7})
        bridge.prepare_for_export(self.server)
        self.assertIsNone(self.server.base.fetch("pairingCode"))
        self.assertIsNone(self.server.base.startup["pairingCode"])
        self.assertEqual(self.server.startup["fuzzClients"], {})
        self.assertEqual(self.server.startup["fuzzPending"], {})
        self.assertEqual(bridge._clients(self.server), {})
        self.assertEqual(bridge._pending(self.server), {})
        self.assertNotIn(self.server, bridge._expiry_jobs)
        self.assertTrue(all(job.killed for job in self.jobs))
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
