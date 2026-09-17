"""Local pipe/lifecycle regressions; real Vision smoke test skips without a build."""

from pathlib import Path
import importlib.util
import shlex
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from lights.mask_worker import MaskWorker


FAKE_HELPER = r'''
import pathlib, signal, struct, sys, time
mode, ready, release = sys.argv[1:]
def read_exact(size):
    data = bytearray()
    while len(data) < size:
        part = sys.stdin.buffer.read(size - len(data))
        if not part: return None
        data.extend(part)
    return data
count = 0
while True:
    header = read_exact(8)
    if header is None: break
    width, height = struct.unpack('<II', header)
    pixels = read_exact(width * height * 4)
    if pixels is None: break
    count += 1
    if mode == 'crash': sys.exit(19)
    if mode == 'hostile':
        sys.stdout.buffer.write(struct.pack('<II', 0xffffffff, 0xffffffff))
        sys.stdout.buffer.flush()
        break
    if mode == 'truncated':
        sys.stdout.buffer.write(header + b'\x00')
        sys.stdout.buffer.flush()
        break
    if mode == 'ignore-term':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        pathlib.Path(ready).touch()
        while True: time.sleep(.05)
    if mode == 'hold-first' and count == 1:
        pathlib.Path(ready).touch()
        while not pathlib.Path(release).exists(): time.sleep(.005)
    response = header + bytes([pixels[0]]) * (width * height)
    # Force the receiver to assemble partial header and payload reads.
    for part in (response[:3], response[3:9], response[9:]):
        sys.stdout.buffer.write(part)
        sys.stdout.buffer.flush()
        time.sleep(.002)
'''


class MaskWorkerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='light-maps-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.workers = []
        self.addCleanup(self.close_workers)

    def close_workers(self):
        for worker in self.workers:
            worker.close()
            # Keep a failing close regression from leaving our fake child alive.
            process = worker._process
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=2)
            worker._thread.join(timeout=2)

    def worker(self, mode='normal'):
        folder = self.root / str(len(self.workers))
        folder.mkdir()
        source = folder / 'helper.py'
        source.write_text(FAKE_HELPER)
        executable = folder / 'helper'
        ready, release = folder / 'ready', folder / 'release'
        arguments = [sys.executable, str(source), mode, str(ready), str(release)]
        executable.write_text('#!/bin/sh\nexec ' + ' '.join(map(shlex.quote, arguments)) + '\n')
        executable.chmod(0o700)
        worker = MaskWorker(executable)
        self.workers.append(worker)
        return worker, ready, release

    def await_value(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(.005)
        self.fail('Timed out waiting for helper state')

    @staticmethod
    def frame(marker, width=4, height=3):
        return bytes([marker, 0, 0, 255]) * (width * height)

    def test_exact_fragmented_round_trip_and_age_from_capture(self):
        worker, _, _ = self.worker()
        captured = time.monotonic()
        worker.submit(self.frame(123), 4, 3, captured)
        result = self.await_value(lambda: worker.latest(maximum_age=10))
        self.assertEqual(result, (bytes([123]) * 12, 4, 3, captured))
        with patch('lights.mask_worker.time.monotonic', return_value=captured + .36):
            self.assertIsNone(worker.latest())

    def test_only_newest_waiting_frame_survives(self):
        worker, ready, release = self.worker('hold-first')
        worker.submit(self.frame(1), 4, 3, time.monotonic())
        self.await_value(ready.exists)
        for marker in range(2, 50):
            worker.submit(self.frame(marker), 4, 3, time.monotonic())
        with worker._condition:
            self.assertEqual(worker._pending[0], self.frame(49))
        release.touch()
        result = self.await_value(lambda: (
            value if (value := worker.latest(maximum_age=10)) and value[0][0] == 49 else None
        ))
        self.assertEqual(result[0], bytes([49]) * 12)

    def test_invalid_inputs_are_rejected_before_sending(self):
        worker, _, _ = self.worker()
        for width, height, pixels in [(0, 1, b''), (513, 1, b''),
                                      (1, 0, b''), (1, 513, b''), (4, 3, b'bad')]:
            with self.subTest(width=width, height=height):
                with self.assertRaises(ValueError):
                    worker.submit(pixels, width, height, time.monotonic())
        self.assertIsNone(worker.error)

    def test_crash_or_hostile_reply_clears_state_and_stops(self):
        for mode in ('crash', 'hostile', 'truncated'):
            with self.subTest(mode=mode):
                worker, _, _ = self.worker(mode)
                worker.submit(self.frame(1), 4, 3, time.monotonic())
                self.await_value(lambda: worker.error)
                self.assertIsNone(worker.latest())
                worker.submit(self.frame(2), 4, 3, time.monotonic())
                with worker._condition:
                    self.assertIsNone(worker._pending)
                worker.close()
                self.assertFalse(worker._thread.is_alive())
                self.assertIsNotNone(worker._process.poll())

    def test_missing_helper_reports_failure(self):
        worker = MaskWorker(self.root / 'missing')
        self.workers.append(worker)
        self.await_value(lambda: worker.error)
        self.assertIsNone(worker.latest())

    def test_close_clears_frames_and_ends_waiting_process(self):
        worker, _, _ = self.worker()
        worker.submit(self.frame(10), 4, 3, time.monotonic())
        self.await_value(lambda: worker.latest(maximum_age=10))
        worker.close()
        worker.close()
        self.assertFalse(worker._thread.is_alive())
        self.assertIsNotNone(worker._process.poll())
        self.assertIsNone(worker.latest())
        worker.submit(self.frame(20), 4, 3, time.monotonic())
        self.assertIsNone(worker._pending)

    def test_close_kills_helper_that_ignores_terminate(self):
        worker, ready, _ = self.worker('ignore-term')
        worker.submit(self.frame(10), 4, 3, time.monotonic())
        self.await_value(ready.exists)
        worker.close()
        self.assertFalse(worker._thread.is_alive())
        self.assertIsNotNone(worker._process.poll())

    @unittest.skipUnless(sys.platform == 'darwin' and
                         (Path(__file__).parent / 'lights/.build/person-mask').is_file(),
                         'Build the local Vision helper to run its smoke test')
    def test_real_helper_blank_frame(self):
        worker = MaskWorker(Path(__file__).parent / 'lights/.build/person-mask')
        self.workers.append(worker)
        worker.submit(self.frame(0, 256, 144), 256, 144, time.monotonic())
        result = self.await_value(lambda: worker.latest(maximum_age=15), timeout=15)
        self.assertEqual(result[1:3], (256, 144))
        self.assertEqual(len(result[0]), 256 * 144)
        self.assertLess(max(result[0]), 128)
        self.assertIsNone(worker.error)


class MaskLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='light-maps-lifecycle-')
        self.addCleanup(self.directory.cleanup)
        folder = Path(self.directory.name)
        self.helper = folder / '.build' / 'person-mask'
        self.helper.parent.mkdir()
        self.helper.touch()
        spec = importlib.util.spec_from_file_location(
            'mask_callbacks_test', Path(__file__).parent / 'lights/mask_callbacks.py')
        self.callbacks = importlib.util.module_from_spec(spec)
        # Lifecycle checks do not use NumPy or need a TouchDesigner process.
        with patch.dict(sys.modules, {'numpy': SimpleNamespace()}):
            spec.loader.exec_module(self.callbacks)
        self.callbacks.HELPER_DIRECTORY = folder
        self.mode, self.active, self.camera_error = 'lightmaps', True, ''
        self.camera = SimpleNamespace(
            par=SimpleNamespace(active=SimpleNamespace(eval=lambda: self.active)),
            errors=lambda: self.camera_error)
        fuzz = SimpleNamespace(
            par=SimpleNamespace(View=SimpleNamespace(eval=lambda: self.mode)),
            op=lambda name: self.camera)
        self.base = SimpleNamespace(parent=lambda: fuzz)
        self.result = (b'\xff', 1, 1, time.monotonic())
        self.closed = False
        self.worker = SimpleNamespace(latest=lambda: self.result, close=self.mark_closed)
        self.callbacks._worker = self.worker
        self.callbacks._ready = True

    def mark_closed(self):
        self.closed = True

    def test_cached_ready_does_not_outlive_fresh_worker_result(self):
        self.assertEqual(self.callbacks.is_ready(self.base), 1)
        self.result = None
        self.assertEqual(self.callbacks.is_ready(self.base), 0)
        self.assertTrue(self.callbacks._ready)  # No onCook was needed to fail closed.

    def test_inactive_environment_stops_worker_without_a_mask_cook(self):
        for unavailable in ('mode', 'camera-off', 'camera-error', 'helper-missing'):
            with self.subTest(unavailable=unavailable):
                self.mode, self.active, self.camera_error = 'lightmaps', True, ''
                self.helper.touch()
                self.callbacks._worker, self.callbacks._ready = self.worker, True
                self.closed = False
                if unavailable == 'mode': self.mode = 'fuzz'
                elif unavailable == 'camera-off': self.active = False
                elif unavailable == 'camera-error': self.camera_error = 'Unavailable'
                else: self.helper.unlink()
                self.assertEqual(self.callbacks.is_ready(self.base), 0)
                self.assertIsNotNone(self.callbacks.maintain_lifecycle(self.base))
                self.assertTrue(self.closed)
                self.assertIsNone(self.callbacks._worker)
                self.assertFalse(self.callbacks._ready)

    def test_active_environment_keeps_worker_but_not_empty_person_mask(self):
        self.assertIsNone(self.callbacks.maintain_lifecycle(self.base))
        self.assertIs(self.callbacks._worker, self.worker)
        self.assertFalse(self.closed)
        self.callbacks._ready = False
        self.assertEqual(self.callbacks.is_ready(self.base), 0)


if __name__ == '__main__':
    unittest.main()
