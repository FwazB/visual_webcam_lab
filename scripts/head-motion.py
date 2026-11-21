#!/usr/bin/env python3
"""Run the Body Synth website's local AirPods motion bridge."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import time

FUZZ = Path(__file__).resolve().parents[1] / "touchdesigner" / "fuzz"
sys.path.insert(0, str(FUZZ))
from head_tilt import TiltReceiver, mac_helper_path, supports_mac_motion

PORT = 9982
SITE = "https://body-synth-beta.vercel.app"
LEASE_SECONDS = 4
PHONE_NETWORKS = tuple(map(ipaddress.IPv4Network, (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "127.0.0.1/32")))


class MotionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def valid_phone(phone):
    if not isinstance(phone, str) or len(phone) > 15:
        return False
    try:
        address = ipaddress.IPv4Address(phone)
    except ValueError:
        return False
    return any(address in network for network in PHONE_NETWORKS)


def allowed_origin(origin):
    if origin == SITE:
        return True
    match = re.fullmatch(r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})", origin)
    return bool(match and 1 <= int(match[1]) <= 65535)


class Motion:
    def __init__(self, receiver=None):
        self.receiver = receiver or TiltReceiver()
        self.owner = None
        self.deadline = 0
        self.condition = threading.Condition()
        self.closing = False
        self.thread = threading.Thread(target=self._capture, daemon=True)
        self.thread.start()

    def _advance(self, now):
        if self.owner is None:
            return
        if now >= self.deadline:
            self.receiver.close()
            self.owner = None
        else:
            self.receiver.poll(now)
            if not self.receiver.enabled:
                self.owner = None

    def _capture(self):
        with self.condition:
            while not self.closing:
                self._advance(time.monotonic())
                self.condition.wait(timeout=1 / 60 if self.owner is not None else None)

    def close(self):
        with self.condition:
            self.closing = True
            self.owner = None
            self.receiver.close()
            self.condition.notify()
        self.thread.join()

    def command(self, session, message):
        with self.condition:
            now = time.monotonic()
            self._advance(now)
            action = message.get("action")
            if action not in ("start", "status", "center", "stop"):
                raise MotionError(400, "Unknown motion action.")
            if self.closing:
                raise MotionError(503, "The motion bridge is closing.")
            if self.owner not in (None, session):
                if action != "status":
                    raise MotionError(409, "Another tab is using motion.")
                return {"enabled": True, "owned": False, "degrees": None, "status": "Another tab is using motion."}
            reader = self.receiver
            if action == "start":
                source = message.get("source")
                if source == "mac":
                    if reader.helper is None:
                        try:
                            reader.start_mac()
                        except ValueError as error:
                            if not reader.enabled:
                                self.owner = None
                            raise MotionError(503, str(error)) from error
                elif source == "iphone" and valid_phone(message.get("phone")):
                    if reader.socket is None or reader.phone != message["phone"]:
                        reader.listen(message["phone"])
                        if not reader.enabled:
                            self.owner = None
                            raise MotionError(503, reader.status)
                else:
                    raise MotionError(400, "Select Mac or enter the iPhone’s local Wi-Fi IPv4 address.")
                self.owner = session
                self.condition.notify()
            elif action == "center":
                if not reader.enabled:
                    raise MotionError(409, "Start tracking before setting center.")
                reader.recenter(now)
            elif action == "stop":
                reader.close()
                self.owner = None
            if self.owner == session:
                self.deadline = now + LEASE_SECONDS
            degrees = None
            if reader.last_roll is not None and reader.center is not None:
                degrees = (reader.last_roll - reader.center + 180) % 360 - 180
            status = reader.status
            if reader.destination:
                status += " · Send to " + reader.destination
            return {"enabled": reader.enabled, "owned": self.owner == session,
                    "degrees": degrees, "status": status}


class MotionServer(ThreadingHTTPServer):
    def __init__(self, port, motion, code):
        self.motion = motion
        self.token = "Bearer " + code
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), MotionHandler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        request.settimeout(1)
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class MotionHandler(BaseHTTPRequestHandler):
    # Never log credentials, device addresses or incoming sensor data.
    def log_message(self, format, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (ConnectionError, TimeoutError):
            pass  # A tab may close during a poll or a partial request.

    def header(self, name):
        values = self.headers.get_all(name, [])
        return values[0] if len(values) == 1 else ""

    def reply(self, code, data=None):
        body = b"" if data is None else json.dumps(data, allow_nan=False).encode()
        self.send_response(code)
        origin = self.header("Origin")
        if allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        if code == 204:
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Motion-Session")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def check_route(self):
        if self.header("Host") != f"127.0.0.1:{self.server.server_port}" or not allowed_origin(self.header("Origin")):
            self.reply(403, {"error": "Use the Body Synth website or its local development server."})
        elif self.path != "/motion":
            self.reply(404, {"error": "Unknown endpoint."})
        else:
            return True
        return False

    def do_OPTIONS(self):
        if self.check_route():
            method = self.header("Access-Control-Request-Method")
            if method == "POST":
                self.reply(204)
            else:
                self.reply(405, {"error": "Use POST."})

    def do_POST(self):
        if not self.check_route():
            return
        auth = self.header("Authorization")
        session = self.header("X-Motion-Session")
        if not auth.isascii() or not hmac.compare_digest(auth, self.server.token):
            self.reply(401, {"error": "Check the pairing code printed by the bridge."})
            return
        if not re.fullmatch("[A-Za-z0-9_-]{16,128}", session):
            self.reply(400, {"error": "Invalid motion session."})
            return
        length = self.header("Content-Length")
        if (not re.fullmatch("[0-9]{1,4}", length) or not 0 < int(length) <= 1024
                or self.headers.get("Transfer-Encoding") is not None
                or self.header("Content-Type").split(";")[0].strip().lower() != "application/json"):
            self.reply(400, {"error": "Send a small JSON motion command."})
            return
        try:
            body = self.rfile.read(int(length))
            if len(body) != int(length):
                raise ValueError
            message = json.loads(body)
            if not isinstance(message, dict):
                raise ValueError
            data = self.server.motion.command(session, message)
        except (ValueError, UnicodeError, RecursionError):
            self.reply(400, {"error": "Invalid motion command."})
        except MotionError as error:
            self.reply(error.code, {"error": str(error)})
        else:
            self.reply(200, data)


def main():
    code = secrets.token_urlsafe(18)
    motion = Motion()
    try:
        try:
            server = MotionServer(PORT, motion, code)
        except OSError as error:
            print(f"Could not open the Body Synth motion bridge on port {PORT}: {error.strerror}.", file=sys.stderr)
            return 1
        with server:
            if supports_mac_motion() and not mac_helper_path().is_file():
                result = subprocess.run(["sh", str(FUZZ / "headphones/build.sh")])
                if result.returncode:
                    print("The Mac helper build failed. The iPhone sender is still available.", file=sys.stderr)
            print(f"Motion bridge: http://127.0.0.1:{PORT}/motion\nOpen on this Mac: {SITE}/#motion-code={code}"
                  f"\nPairing code: {code}\nKeep this terminal open while playing. Press Control-C to stop.", flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        motion.close()
    return 0


if __name__ == "__main__":
    def terminate(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, terminate)
    raise SystemExit(main())
