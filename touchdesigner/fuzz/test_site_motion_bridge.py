"""Standalone website bridge, real loopback HTTP/UDP, and a synthetic Mac reader."""
from http.client import HTTPConnection
import importlib.util
import json
from pathlib import Path
import secrets
import select
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import head_tilt

spec = importlib.util.spec_from_file_location(
    "site_motion", Path(__file__).resolve().parents[2] / "scripts/head-motion.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class LocalReceiver(head_tilt.TiltReceiver):
    def listen(self, phone):
        super().listen(phone, port=0)


class BridgeFixture(unittest.TestCase):
    pairing_code = "test-pairing-code"

    def setUp(self):
        self.reader = LocalReceiver()
        self.motion = bridge.Motion(self.reader)
        self.addCleanup(self.motion.close)
        self.server = bridge.MotionServer(0, self.motion, self.pairing_code)
        self.addCleanup(self.server.server_close)
        thread = threading.Thread(target=self.server.serve_forever, args=(0.01,))
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        self.headers = {"Origin": bridge.SITE, "Authorization": "Bearer test-pairing-code",
                        "X-Motion-Session": "first-session-token", "Content-Type": "application/json"}

    def request(self, data, *, headers=None, method="POST", path="/motion"):
        c = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        try:
            c.request(method, path, None if data is None else json.dumps(data),
                      headers={**self.headers, **(headers or {})})
            response = c.getresponse()
            raw = response.read()
            return response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        finally:
            c.close()

    def command(self, action, **kwargs):
        code, _, data = self.request({"action": action, **kwargs})
        self.assertEqual(code, 200, data)
        return data

    def wait_for(self, predicate):
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            with self.motion.condition:
                if predicate():
                    return
            time.sleep(0.01)
        self.fail("Motion worker did not produce the expected state")


class SiteMotionTests(BridgeFixture):
    def test_preflight_and_restricted_request_boundary(self):
        code, headers, data = self.request(None, method="OPTIONS", headers={
            "Origin": "http://localhost:3000", "Authorization": "", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization, content-type, x-motion-session",
            "Access-Control-Request-Private-Network": "true"})
        self.assertEqual((code, data), (204, None))
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://localhost:3000")
        self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
        for origin in ("https://other-site.example", "http://localhost.bad:3000", "null", ""):
            code, headers, _ = self.request({"action": "start"}, headers={"Origin": origin})
            self.assertEqual(code, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)
        for override, expected in (({"Host": "other-site.example"}, 403), ({"Authorization": "Bearer no"}, 401),
                                   ({"X-Motion-Session": ""}, 400), ({"Content-Type": "text/plain"}, 400)):
            self.assertEqual(self.request({"action": "start"}, headers=override)[0], expected)
        self.assertEqual(self.request({"action": "start"}, path="/")[0], 404)
        self.assertEqual(self.request({"action": "start", "source": "iphone", "phone": "1.1.1.1"})[0], 400)
        self.assertFalse(self.reader.enabled)

    def test_first_udp_pose_signed_output_recenter_and_stale(self):
        state = self.command("start", source="iphone", phone="127.0.0.1")
        self.assertTrue(state["owned"])
        self.assertIn("127.0.0.1:", state["status"])
        destination = self.reader.socket.getsockname()
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
            # Queue both before the first receiver tick. No HTTP poll drives the capture.
            with self.motion.condition:
                for roll in (12, -8):
                    sender.sendto(struct.pack("<6d", 0, 0, 0, 0, 0, roll), destination)
            self.wait_for(lambda: self.reader.last_roll == -8)
            self.assertEqual(self.command("status")["degrees"], -20)
            self.assertEqual(self.command("center")["degrees"], 0)
            sender.sendto(struct.pack("<6d", 0, 0, 0, 0, 0, 11), destination)
            self.wait_for(lambda: self.reader.last_roll == 11)
            self.assertEqual(self.command("status")["degrees"], 19)
            self.wait_for(lambda: self.reader.last_roll is None)
            state = self.command("status")
            self.assertIsNone(state["degrees"])
            self.assertIn("Signal lost", state["status"])
        self.assertEqual(self.command("stop"), {"degrees": None, "enabled": False, "owned": False, "status": "Off"})
        self.assertIsNone(self.reader.socket)

    def test_second_tab_cannot_take_control_or_keep_abandoned_session_alive(self):
        other = {"X-Motion-Session": "second-session-token"}
        with patch.object(bridge, "LEASE_SECONDS", 0.15):
            self.command("start", source="iphone", phone="127.0.0.1")
            for action in ("start", "stop", "center"):
                self.assertEqual(self.request({"action": action}, headers=other)[0], 409)
            state = self.request({"action": "status"}, headers=other)[2]
            self.assertTrue(state["enabled"])
            self.assertFalse(state["owned"])
            self.assertIsNone(state["degrees"])
            self.wait_for(lambda: not self.reader.enabled)
        self.assertEqual(self.request({"action": "start", "source": "iphone", "phone": "127.0.0.1"},
                                      headers=other)[0], 200)

    def test_mac_reader_starts_tracks_signed_roll_and_stops_process(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "mock-reader"
            app.write_text("#!/bin/sh\nprintf '%s\\n' '{\"roll\":-10}' '{\"roll\":15}'\nexec cat\n")
            app.chmod(0o700)
            with patch.object(head_tilt, "supports_mac_motion", return_value=True), \
                 patch.object(head_tilt, "mac_helper_path", return_value=app):
                self.command("start", source="mac")
                process = self.reader.helper
                self.wait_for(lambda: self.reader.last_roll == 15)
                self.assertEqual(self.command("status")["degrees"], 25)
                self.command("stop")
                self.assertIsNotNone(process.poll())


class WebsiteSessionTests(BridgeFixture):
    pairing_code = None

    def setUp(self):
        super().setUp()
        self.nonce = secrets.token_hex(32)
        self.tab = str(uuid4())
        self.headers.update({"Authorization": "Bearer " + self.nonce, "X-Motion-Session": self.tab})
        self.start = {"action": "start", "source": "iphone", "phone": "127.0.0.1"}

    def test_website_launch_requires_deployed_origin_explicit_start_and_tab_ownership(self):
        self.assertEqual(self.request(self.start)[0], 401)
        self.assertTrue(self.server.website.register(self.nonce))
        self.assertFalse(self.reader.enabled)
        preflight = {"Access-Control-Request-Method": "POST"}
        self.assertEqual(self.request(None, method="OPTIONS", headers=preflight)[0], 204)
        for origin in ("http://localhost:3000", "https://body-synth-beta.vercel.app.local",
                       "http://body-synth-beta.vercel.app", "null"):
            for data, method in ((None, "OPTIONS"), (self.start, "POST")):
                code, headers, _ = self.request(data, method=method, headers={**preflight, "Origin": origin})
                self.assertEqual(code, 403)
                self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.request(self.start, headers={"Host": "localhost:9982"})[0], 403)
        self.assertEqual(self.request(self.start, headers={"X-Motion-Session": "guessable-tab-name"})[0], 400)
        for action in ("status", "center"):
            self.assertEqual(self.request({"action": action})[0], 401)
        self.assertFalse(self.reader.enabled)
        # Invalid start cannot consume a launch or claim capture.
        self.assertEqual(self.request({**self.start, "phone": "8.8.8.8"})[0], 400)
        self.assertTrue(self.request(self.start)[2]["owned"])
        original_socket = self.reader.socket
        # A repeated HTTP start from the same tab keeps its first source.
        self.assertTrue(self.request({"action": "start", "source": "mac"})[2]["owned"])
        self.assertIs(self.reader.socket, original_socket)
        for action in ("start", "status", "center", "stop"):
            self.assertEqual(self.request({**self.start, "action": action},
                                          headers={"X-Motion-Session": str(uuid4())})[0], 401)
        self.assertTrue(self.reader.enabled)
        other_nonce = secrets.token_hex(32)
        self.assertTrue(self.server.website.register(other_nonce))
        other = {"Authorization": "Bearer " + other_nonce, "X-Motion-Session": str(uuid4())}
        self.assertEqual(self.request(self.start, headers=other)[0], 409)
        cancelled = secrets.token_hex(32)
        self.assertTrue(self.server.website.register(cancelled))
        cancelled_tab = {**other, "Authorization": "Bearer " + cancelled}
        self.assertFalse(self.request({"action": "stop"}, headers=cancelled_tab)[2]["enabled"])
        self.assertEqual(self.request(self.start, headers=cancelled_tab)[0], 401)
        self.assertTrue(self.command("center")["owned"])
        self.assertFalse(self.command("stop")["enabled"])
        self.assertEqual(original_socket.fileno(), -1)
        self.assertFalse(self.server.website.register(self.nonce))
        self.assertEqual(self.request(self.start)[0], 401)
        self.assertTrue(self.request(self.start, headers=other)[2]["owned"])

    def test_launch_expiry_lease_loss_and_bounded_registration(self):
        with patch.object(bridge, "LAUNCH_SECONDS", 0), patch.object(bridge, "MAX_LAUNCHES", 2):
            self.assertTrue(self.server.website.register(self.nonce))
            self.assertEqual(self.request(self.start)[0], 401)
            self.assertFalse(self.server.website.register(self.nonce))
        with patch.object(bridge, "MAX_LAUNCHES", 2), patch.object(bridge, "LEASE_SECONDS", 0.07):
            self.nonce = secrets.token_hex(32)
            self.headers["Authorization"] = "Bearer " + self.nonce
            self.assertTrue(self.server.website.register(self.nonce))
            self.assertTrue(self.server.website.register(self.nonce))
            self.assertFalse(self.server.website.register(secrets.token_hex(32)))
            self.assertTrue(self.request(self.start)[2]["owned"])
            self.wait_for(lambda: not self.reader.enabled)
            for action in ("status", "start", "stop"):
                self.assertEqual(self.request({**self.start, "action": action})[0], 401)
            self.assertFalse(self.server.website.register(self.nonce))


class WebsiteProcessTests(unittest.TestCase):
    def spawn(self, port, idle_seconds=60):
        # Exercise the shipped CLI with an isolated port and a fast idle clock.
        boot = """
import importlib.util, sys
spec = importlib.util.spec_from_file_location("site_motion", sys.argv.pop(1))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.PORT = int(sys.argv.pop(1))
module.IDLE_SECONDS = float(sys.argv.pop(1))
raise SystemExit(module.main())
"""
        proc = subprocess.Popen([sys.executable, "-B", "-c", boot, str(spec.origin),
                                 str(port), str(idle_seconds), "--website-session"], bufsize=0,
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        def close():
            proc.stdin.close()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            proc.stdout.close()
            proc.stderr.close()
        self.addCleanup(close)
        return proc

    def read_ack(self, proc):
        self.assertTrue(select.select([proc.stdout], [], [], 3)[0], "Missing bridge acknowledgement")
        self.assertEqual(proc.stdout.readline(), b"ACCEPTED\n")

    def free_port(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def test_partial_and_multiple_lines_do_not_block_http_and_eof_closes(self):
        port = self.free_port()
        proc = self.spawn(port)
        nonce = secrets.token_hex(32).encode()
        second = secrets.token_hex(32).encode()
        headers = {"Origin": bridge.SITE, "Access-Control-Request-Method": "POST"}
        proc.stdin.write(b"bad\n" + nonce + b"\n" + second[:12])
        self.read_ack(proc)
        conn = HTTPConnection("127.0.0.1", port, timeout=2)
        try:
            conn.request("OPTIONS", "/motion", headers=headers)
            reply = conn.getresponse()
            self.assertEqual(reply.status, 204)
            reply.read()
        finally:
            conn.close()
        proc.stdin.write(second[12:] + b"\n" + b"a" * 100 + b"\n" + secrets.token_hex(32).encode() + b"\n")
        self.read_ack(proc)
        self.read_ack(proc)
        proc.stdin.close()
        self.assertEqual(proc.wait(timeout=3), 0)
        self.assertEqual(proc.stdout.read(), b"")
        self.assertEqual(proc.stderr.read(), b"")

    def test_idle_exits_and_busy_port_fails_before_acknowledgement(self):
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            proc = self.spawn(occupied.getsockname()[1])
            proc.stdin.write(secrets.token_hex(32).encode() + b"\n")
            self.assertNotEqual(proc.wait(timeout=3), 0)
            self.assertEqual(proc.stdout.read(), b"")
            self.assertIn(b"Could not open", proc.stderr.read())
        idle = self.spawn(self.free_port(), idle_seconds=0.1)
        idle.stdin.write(secrets.token_hex(32).encode() + b"\n")
        self.read_ack(idle)
        self.assertEqual(idle.wait(timeout=3), 0)
