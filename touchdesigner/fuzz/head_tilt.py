"""Local Mac headphone motion or iPhone UDP roll for the Fuzz trail."""

import ipaddress
import json
import math
import os
from pathlib import Path
import platform
import socket
import struct
import subprocess
import time

PORT = 4242
POSE = struct.Struct("<6d")  # x, y, z, yaw, pitch, roll (angles in degrees)
STALE_SECONDS = 0.5
DEAD_ZONE = 3.0
FULL_TILT = 25.0


def supports_mac_motion():
    version = platform.mac_ver()[0]
    return bool(version) and int(version.split(".")[0]) >= 14


def mac_helper_path():
    try:
        directory = Path(project.folder)
    except NameError:  # Standalone bridge imports this module outside TouchDesigner.
        directory = Path(__file__).resolve().parent
    return (directory / "headphones/.build/Fuzz Head Motion.app"
            / "Contents/MacOS/FuzzHeadMotion")


def valid_phone(phone):
    if not isinstance(phone, str) or len(phone) > 15:
        return False
    try:
        peer = ipaddress.IPv4Address(phone)
    except ValueError:
        return False
    return peer.is_private and not (peer.is_unspecified or peer.is_reserved or peer.is_multicast)


class TiltReceiver:
    def __init__(self):
        self.socket = None
        self.helper = None
        self.close()

    @property
    def enabled(self):
        return self.socket is not None or self.helper is not None

    def close(self):
        if self.helper is not None:
            helper, self.helper = self.helper, None
            helper.stdin.close()
            helper.stdout.close()
            if helper.poll() is None:
                helper.terminate()
            try:
                helper.wait(timeout=0.3)
            except subprocess.TimeoutExpired:
                helper.kill()
                helper.wait()
        if self.socket is not None:
            self.socket.close()
            self.socket = None
        self.partial_line = b""
        self.helper_status = None
        self.phone = None
        self.destination = None
        self.center = None
        self.last_roll = None
        self.degrees = None
        self.last_sample = None
        self.amount = 0.0
        self.status = "Off"

    def start_mac(self):
        if not supports_mac_motion():
            raise ValueError("Mac head tracking requires macOS 14 or later.")
        executable = mac_helper_path()
        if not os.access(executable, os.X_OK):
            raise ValueError("Build the Mac head motion helper first.")
        self.close()
        try:
            self.helper = subprocess.Popen([str(executable)], stdin=subprocess.PIPE,
                                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            os.set_blocking(self.helper.stdout.fileno(), False)
        except OSError:
            self.close()
            raise ValueError("Build the Mac head motion helper first.") from None
        self.status = "Waiting for AirPods connected to this Mac"

    def listen(self, phone, port=PORT):
        self.close()
        self.phone = phone
        if not valid_phone(phone):
            self.status = "Enter your iPhone’s Wi-Fi IPv4 address"
            return
        try:
            # Ask the OS which interface reaches this phone. No packet is sent.
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as route:
                route.connect((phone, PORT))
                local_ip = route.getsockname()[0]
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.socket.setblocking(False)
            self.socket.bind((local_ip, port))
            self.destination = f"{local_ip}:{self.socket.getsockname()[1]}"
            self.status = "Hold neutral · waiting for tilt"
        except OSError as error:
            self.fail(error)

    def fail(self, error):
        phone = self.phone
        self.close()
        self.phone = phone  # Retry only after toggling or changing the address.
        self.status = f"Receiver stopped ({error.strerror}). Toggle off and on to retry."

    def expire(self, now):
        if self.last_sample is not None and now - self.last_sample >= STALE_SECONDS:
            self.amount = 0.0
            self.last_sample = self.last_roll = self.degrees = None
            self.status = "Signal lost · normal feedback"

    def recenter(self, now):
        self.expire(now)
        self.center = self.last_roll  # With no fresh sample the next pose sets center.
        self.amount = 0.0
        self.degrees = 0.0 if self.center is not None else None
        self.status = "Centered" if self.center is not None else "Hold neutral · waiting for tilt"

    def poll(self, now):
        self.expire(now)
        if self.helper is not None:
            self.poll_mac(now)
            return
        if self.socket is None:
            return
        roll = None
        try:
            # Bound per-frame work and use only the newest valid pose.
            for _ in range(64):
                data, source = self.socket.recvfrom(POSE.size + 1)
                if source[0] != self.phone or len(data) != POSE.size:
                    continue
                candidate = POSE.unpack(data)[5]
                if math.isfinite(candidate) and abs(candidate) <= 180:
                    if self.center is None:
                        self.center = candidate
                    roll = candidate
        except BlockingIOError:
            pass
        except OSError as error:
            self.fail(error)
            return

        if roll is not None:
            self.apply_roll(roll, now)

    def poll_mac(self, now):
        try:
            data = os.read(self.helper.stdout.fileno(), 8192)
        except BlockingIOError:
            return
        except OSError:
            data = b""
        if not data:
            message = self.helper_status or "Mac motion reader stopped. Start tracking to retry."
            self.close()
            self.status = message
            return
        *lines, self.partial_line = (self.partial_line + data).split(b"\n")
        if len(self.partial_line) > 1024:
            self.partial_line = b""
        roll = None
        for line in lines:
            try:
                sample = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(sample, dict):
                continue
            if isinstance(sample.get("status"), str):
                self.helper_status = self.status = sample["status"][:200]
                self.amount = 0.0
                self.degrees = self.last_sample = self.last_roll = roll = None
            else:
                value = sample.get("roll")
                if type(value) in (int, float) and -180 <= value <= 180:
                    self.helper_status = None
                    if self.center is None:
                        self.center = value
                    roll = value
        if roll is not None:
            self.apply_roll(roll, now)

    def apply_roll(self, roll, now):
        if self.center is None:
            self.center = roll
        degrees = abs((roll - self.center + 180) % 360 - 180)
        target = min(1.0, max(0.0, (degrees - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE)))
        dt = 1 / 60 if self.last_sample is None else now - self.last_sample
        self.amount += (target - self.amount) * -math.expm1(-dt / 0.08)
        if abs(target - self.amount) < 0.001:
            self.amount = target
        self.last_sample = now
        self.last_roll = roll
        self.degrees = degrees
        self.status = f"Tracking · {degrees:.0f}° tilt"


receiver = TiltReceiver()
# Website ownership and its phone address are runtime-only. Local panel values
# stay available for the next manual session.
_web_owner = None


def release_web(client=None):
    global _web_owner
    if _web_owner is not None and (client is None or client == _web_owner):
        _web_owner = None
        receiver.close()


def configure(base):
    """Install the controls on project open, including for the shared .toe."""
    release_web()
    receiver.close()
    page = next((p for p in base.customPages if p.name == "Head tilt"), None)
    if page is None:
        page = base.appendCustomPage("Head tilt")
    if getattr(base.par, "Phoneip", None) is None:
        page.appendStr("Phoneip", label="iPhone Wi-Fi IP")
    if getattr(base.par, "Headtilt", None) is None:
        page.appendToggle("Headtilt", label="Enable head tilt")
    if getattr(base.par, "Tiltstatus", None) is None:
        page.appendStr("Tiltstatus", label="Receiver")
    base.par.Headtilt.val = False
    base.par.Tiltstatus.expr = "me.op('head_tilt').module.status(absTime.frame)"
    base.par.Tiltstatus.readOnly = True


def update(base):
    global _web_owner
    if getattr(base.par, "Headtilt", None) is None:
        configure(base)
    manual = bool(base.par.Headtilt.eval())
    in_fuzz = base.par.View.eval() == "fuzz"
    if manual or not in_fuzz:
        release_web()
    if not in_fuzz or (not manual and _web_owner is None):
        if receiver.phone is not None:
            receiver.close()
        return
    if manual:
        phone = base.par.Phoneip.eval().strip()
        if phone != receiver.phone:
            receiver.listen(phone)
    receiver.poll(time.monotonic())
    if not receiver.enabled:
        _web_owner = None


def web_command(base, client, kind, phone=None):
    """Run one authenticated control and return one bounded status response."""
    global _web_owner
    update(base)
    if kind in ("tilt.start", "tilt.startMac"):
        if base.par.View.eval() != "fuzz":
            raise ValueError("Select the Fuzz view in TouchDesigner.")
        if base.par.Headtilt.eval() or (_web_owner is not None and _web_owner != client):
            raise ValueError("An existing session controls head tilt.")
        if kind == "tilt.startMac":
            if receiver.helper is None:
                receiver.start_mac()
        elif not valid_phone(phone):
            raise ValueError("Enter the iPhone’s local Wi-Fi IPv4 address.")
        elif receiver.socket is None or receiver.phone != phone:
            receiver.listen(phone)
            if receiver.socket is None:
                message = receiver.status
                receiver.close()
                _web_owner = None
                raise ValueError(message)
        _web_owner = client
    elif kind in ("tilt.stop", "tilt.center"):
        if base.par.Headtilt.eval() or (_web_owner is not None and _web_owner != client):
            raise ValueError("An existing session controls head tilt.")
        if kind == "tilt.stop":
            release_web(client)
        elif not receiver.enabled:
            raise ValueError("Start head tilt before setting center.")
        else:
            receiver.recenter(time.monotonic())
    return {"enabled": receiver.enabled, "owned": _web_owner == client,
            "status": status()[:200], "degrees": receiver.degrees}


def status(_frame=None):
    if receiver.destination is not None:
        return f"{receiver.status} · Send to {receiver.destination}"
    return receiver.status


def opacity(base_opacity, _frame):
    # The manual/audio-driven value remains live at the bottom of the gesture.
    return base_opacity + (0.98 - base_opacity) * receiver.amount
