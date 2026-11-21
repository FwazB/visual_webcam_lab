#!/usr/bin/env python3
"""Run the Body Synth website's local AirPods motion bridge."""

import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import stat
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
LAUNCH_SECONDS = 60
IDLE_SECONDS = 60
MAX_LAUNCHES = 256
LAUNCH_NONCE = re.compile(rb"[0-9a-f]{64}")
TAB_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
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


class WebsiteSessions:
    """The app forwards one fresh nonce per website launch over its private pipe."""

    def __init__(self, motion):
        self.motion = motion
        self.pending = {}
        self.seen = set()
        self.bound = None
        self.idle_deadline = time.monotonic() + IDLE_SECONDS

    def _expire(self, now):
        self.motion._advance(now)
        for nonce, deadline in list(self.pending.items()):
            if deadline <= now:
                del self.pending[nonce]
        if self.bound and self.motion.owner is None:
            self.bound = None
            self.idle_deadline = now + IDLE_SECONDS

    def register(self, nonce):
        with self.motion.condition:
            now = time.monotonic()
            self._expire(now)
            # Bound per-process memory. A replay cannot refresh or reissue a
            # launch after its token expires, is consumed, or its owner stops.
            if nonce in self.pending:
                return True
            digest = hashlib.sha256(nonce.encode("ascii")).digest()
            if digest in self.seen or len(self.seen) >= MAX_LAUNCHES:
                return False
            self.seen.add(digest)
            self.pending[nonce] = now + LAUNCH_SECONDS
            self.idle_deadline = now + IDLE_SECONDS
            return True

    def idle(self):
        with self.motion.condition:
            now = time.monotonic()
            self._expire(now)
            return self.motion.owner is None and now >= self.idle_deadline

    def command(self, nonce, session, message):
        # Use the capture lock for both ownership and credentials so that two
        # request threads cannot claim one launch, including during lease expiry.
        with self.motion.condition:
            now = time.monotonic()
            self._expire(now)
            action = message.get("action")
            if self.bound and hmac.compare_digest(nonce, self.bound) and session == self.motion.owner:
                # A retried Start after a lost HTTP response keeps its first source.
                if action == "start":
                    message = {"action": "status"}
            elif nonce in self.pending and action == "stop":
                # Stop may race a still-in-flight Start for this browser launch.
                del self.pending[nonce]
                return {"enabled": False, "owned": False, "degrees": None, "status": "Off"}
            elif nonce in self.pending and action == "start":
                if self.motion.owner is not None:
                    raise MotionError(409, "Another tab is using motion.")
                result = self.motion.command(session, message)
                del self.pending[nonce]
                self.bound = nonce
                return result
            else:
                raise MotionError(401, "Open the motion companion again from Body Synth.")
            result = self.motion.command(session, message)
            if self.motion.owner is None:
                self.bound = None
                self.idle_deadline = now + IDLE_SECONDS
            return result


class MotionServer(ThreadingHTTPServer):
    def __init__(self, port, motion, code):
        self.motion = motion
        self.token = None if code is None else "Bearer " + code
        self.website = WebsiteSessions(motion) if code is None else None
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), MotionHandler)

    def accepts_origin(self, origin):
        return origin == SITE if self.website is not None else allowed_origin(origin)

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
        if self.server.accepts_origin(origin):
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
        if self.header("Host") != f"127.0.0.1:{self.server.server_port}" or not self.server.accepts_origin(self.header("Origin")):
            self.reply(403, {"error": "Open the Body Synth website."})
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
        website = self.server.website
        if website is not None:
            if not re.fullmatch(r"Bearer [0-9a-f]{64}", auth):
                self.reply(401, {"error": "Open the motion companion again from Body Synth."})
                return
        elif not auth.isascii() or not hmac.compare_digest(auth, self.server.token):
            self.reply(401, {"error": "Check the pairing code printed by the bridge."})
            return
        if not (TAB_ID.fullmatch(session) if website else re.fullmatch("[A-Za-z0-9_-]{16,128}", session)):
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
            data = (website.command(auth[7:], session, message) if website is not None
                    else self.server.motion.command(session, message))
        except (ValueError, UnicodeError, RecursionError):
            self.reply(400, {"error": "Invalid motion command."})
        except MotionError as error:
            self.reply(error.code, {"error": str(error)})
        else:
            self.reply(200, data)


def serve_website(server, pipe):
    # A partial line must never block HTTP or prevent the process timing out.
    pending = b""
    server.timeout = 0
    with selectors.DefaultSelector() as selector:
        selector.register(pipe, selectors.EVENT_READ)
        selector.register(server, selectors.EVENT_READ)
        while not server.website.idle():
            for key, _ in selector.select(0.25):
                if key.fileobj is server:
                    server.handle_request()
                    continue
                data = os.read(pipe.fileno(), 4096)
                if not data:
                    return
                lines = (pending + data).split(b"\n")
                # Keep one extra byte to distinguish an overlong partial line.
                pending = lines.pop()[:65]
                for line in lines:
                    if LAUNCH_NONCE.fullmatch(line):
                        accepted = server.website.register(line.decode("ascii"))
                        print("ACCEPTED" if accepted else "REJECTED", flush=True)


def main():
    args = sys.argv[1:]
    if args not in ([], ["--website-session"]):
        print("Usage: head-motion.py [--website-session]", file=sys.stderr)
        return 2
    website = bool(args)
    if website:
        mode = os.fstat(sys.stdin.fileno()).st_mode
        if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
            print("The website companion requires a private input pipe.", file=sys.stderr)
            return 2
    code = None if website else secrets.token_urlsafe(18)
    motion = Motion()
    try:
        try:
            server = MotionServer(PORT, motion, code)
        except OSError as error:
            print(f"Could not open the Body Synth motion bridge on port {PORT}: {error.strerror}.", file=sys.stderr)
            return 1
        with server:
            if website:
                serve_website(server, sys.stdin.buffer)
                return 0
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
