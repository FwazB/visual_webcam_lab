"""Exercise the phone-to-Fuzz path with real loopback OpenTrack datagrams."""

from pathlib import Path
import select
import shutil
import socket
import struct
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import head_tilt as tilt


class HeadTiltTests(unittest.TestCase):
    def setUp(self):
        self.receiver = tilt.TiltReceiver()
        self.addCleanup(self.receiver.close)
        self.receiver.listen("127.0.0.1", port=0)
        self.destination = self.receiver.socket.getsockname()
        self.sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.addCleanup(self.sender.close)
        self.clock = 0

    def pose(self, roll, yaw=0, pitch=0):
        packet = struct.pack("<6d", 0, 0, 0, yaw, pitch, roll)
        return self.send_pose(packet)

    def send_pose(self, packet):
        self.sender.sendto(packet, self.destination)
        self.assertTrue(select.select([self.receiver.socket], [], [], 1)[0])
        self.clock += 1 / 30
        self.receiver.poll(self.clock)
        return self.receiver.amount

    @unittest.skipUnless(shutil.which("swift"), "Swift toolchain required for iPhone wire format")
    def test_iphone_packets_drive_fuzz_from_a_nonzero_playing_posture(self):
        sender = Path(__file__).resolve().parents[2] / "ios/FuzzTilt/TiltPacket.swift"
        fixture = """
        precondition(TiltPacket.encode(rollDegrees: .nan) == nil)
        precondition(TiltPacket.encode(rollDegrees: 181) == nil)
        for degrees: Double in [-12, 13, -37, -12] {
            FileHandle.standardOutput.write(TiltPacket.encode(rollDegrees: degrees)!)
        }
        """
        run = subprocess.run(["swift", "-"], input=(sender.read_text() + "\n" + fixture).encode(),
                             stdout=subprocess.PIPE, check=True, timeout=90)
        packets = list(struct.iter_unpack("<6d", run.stdout))
        self.assertEqual(packets, [(0, 0, 0, 0, 0, roll) for roll in (-12, 13, -37, -12)])
        size = tilt.POSE.size
        self.assertEqual(self.send_pose(run.stdout[:size]), 0)
        for index in (1, 2):
            self.assertGreater(self.send_pose(run.stdout[index * size:(index + 1) * size]), 0)
        for _ in range(30):
            amount = self.send_pose(run.stdout[3 * size:])
        self.assertEqual(amount, 0)

    def test_calibration_dead_zone_and_independent_axes(self):
        self.assertEqual(self.pose(12), 0)
        self.assertEqual(self.pose(15, yaw=-70, pitch=45), 0)
        self.assertGreater(self.pose(25), 0)
        self.assertLess(self.receiver.amount, 0.6)

    def test_either_shoulder_extends_trail_and_center_restores_live_baseline(self):
        with patch.object(tilt, "receiver", self.receiver):
            self.pose(10)
            self.assertEqual(tilt.opacity(0.65, 1), 0.65)
            for roll in (38, -18):
                for _ in range(30):
                    self.pose(roll)
                self.assertAlmostEqual(tilt.opacity(0.65, 1), 0.98)
                for _ in range(30):
                    self.pose(10)
                self.assertEqual(tilt.opacity(0.45, 1), 0.45)

    def test_wrapped_roll_uses_the_short_angle(self):
        self.pose(179)
        self.assertEqual(self.pose(-179), 0)

    def test_recenter_uses_fresh_roll_or_arms_next_pose_after_loss(self):
        self.pose(11)
        self.pose(31)
        self.assertEqual(self.receiver.degrees, 20)
        self.receiver.recenter(self.clock)
        self.assertEqual((self.receiver.center, self.receiver.degrees, self.receiver.amount), (31, 0, 0))
        self.pose(35)
        self.assertEqual(self.receiver.degrees, 4)
        self.clock += tilt.STALE_SECONDS + 0.001
        self.receiver.recenter(self.clock)
        self.assertEqual((self.receiver.center, self.receiver.degrees, self.receiver.amount), (None, None, 0))
        self.pose(-12)
        self.assertEqual((self.receiver.center, self.receiver.degrees), (-12, 0))

    def test_loss_releases_trail_and_recovery_remembers_center(self):
        self.pose(12)
        self.assertGreater(self.pose(37), 0)
        self.clock += tilt.STALE_SECONDS + 0.001
        self.receiver.poll(self.clock)
        self.assertEqual(self.receiver.amount, 0)
        self.assertIn("lost", self.receiver.status)
        self.assertGreater(self.pose(37), 0)
        self.assertEqual(self.receiver.center, 12)

    def test_invalid_pose_does_not_refresh_the_signal(self):
        self.pose(10)
        self.pose(30)
        for data in (b"", bytes(49), struct.pack("<6d", 0, 0, 0, 0, 0, float("nan")),
                     struct.pack("<6d", 0, 0, 0, 0, 0, 400)):
            self.sender.sendto(data, self.destination)
        self.receiver.poll(self.clock + tilt.STALE_SECONDS + 0.001)
        self.assertEqual(self.receiver.amount, 0)
        self.assertIsNone(self.receiver.last_sample)

    def test_only_configured_phone_sets_center(self):
        self.receiver.phone = "192.168.1.75"
        self.pose(45)
        self.assertIsNone(self.receiver.center)

    def test_disable_or_leave_fuzz_releases_port_and_calibration(self):
        self.pose(12)
        self.pose(37)
        for enabled, view in ((True, "lightmaps"), (False, "fuzz")):
            base = SimpleNamespace(par=SimpleNamespace(
                Headtilt=Mock(eval=lambda: enabled), View=Mock(eval=lambda: view)))
            with patch.object(tilt, "receiver", self.receiver):
                tilt.update(base)
            self.assertIsNone(self.receiver.socket)
            self.assertIsNone(self.receiver.center)
            self.assertEqual(self.receiver.amount, 0)
            self.receiver.listen("127.0.0.1", self.destination[1])
            self.assertIsNotNone(self.receiver.socket)

    def test_invalid_address_and_occupied_port_report_recoverable_error(self):
        other = tilt.TiltReceiver()
        self.addCleanup(other.close)
        other.listen("")
        self.assertIsNone(other.socket)
        self.assertIn("IPv4", other.status)
        other.listen("127.0.0.1", self.destination[1])
        self.assertIsNone(other.socket)
        self.assertIn("retry", other.status)
        self.receiver.close()
        other.listen("127.0.0.1", self.destination[1])
        self.assertIsNotNone(other.socket)
