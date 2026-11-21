"""Standalone website bridge, real loopback HTTP/UDP, and a synthetic Mac reader."""
from http.client import HTTPConnection
import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import head_tilt

spec = importlib.util.spec_from_file_location(
    "site_motion", Path(__file__).resolve().parents[2] / "scripts/head-motion.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class LocalReceiver(head_tilt.TiltReceiver):
    def listen(self, phone):
        super().listen(phone, port=0)


class SiteMotionTests(unittest.TestCase):
    def setUp(self):
        self.reader = LocalReceiver()
        self.motion = bridge.Motion(self.reader)
        self.addCleanup(self.motion.close)
        self.server = bridge.MotionServer(0, self.motion, "test-pairing-code")
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
