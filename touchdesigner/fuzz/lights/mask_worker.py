"""Bounded local pipe to the macOS Vision helper; no files or network frames."""

import struct
import subprocess
import threading
import time


class MaskWorker:
    def __init__(self, executable):
        self.executable = str(executable)
        self._condition = threading.Condition()
        self._pending = None
        self._latest = None
        self._closed = False
        self._process = None
        self.error = None
        self._thread = threading.Thread(target=self._run, name='light-maps-mask', daemon=True)
        self._thread.start()

    def submit(self, bgra, width, height, captured_at):
        if not 1 <= width <= 512 or not 1 <= height <= 512 or len(bgra) != width * height * 4:
            raise ValueError('Invalid mask input dimensions')
        with self._condition:
            if not self._closed and self.error is None:
                # Replace the waiting frame; never build a queue of old images.
                self._pending = (bytes(bgra), width, height, captured_at)
                self._condition.notify()

    def latest(self, maximum_age=0.35):
        with self._condition:
            value = self._latest
            return value if value is not None and time.monotonic() - value[3] <= maximum_age else None

    @staticmethod
    def _read_exact(pipe, size):
        data = bytearray()
        while len(data) < size:
            part = pipe.read(size - len(data))
            if not part:
                raise EOFError('Mask helper stopped')
            data.extend(part)
        return bytes(data)

    def _run(self):
        process = None
        try:
            process = subprocess.Popen([self.executable], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            with self._condition:
                self._process = process
                if self._closed:
                    return
            while True:
                with self._condition:
                    while self._pending is None and not self._closed:
                        self._condition.wait()
                    if self._closed:
                        break
                    pixels, width, height, captured_at = self._pending
                    self._pending = None
                process.stdin.write(struct.pack('<II', width, height) + pixels)
                process.stdin.flush()
                out_width, out_height = struct.unpack('<II', self._read_exact(process.stdout, 8))
                if (out_width, out_height) != (width, height):
                    raise ValueError('Invalid mask response dimensions')
                mask = self._read_exact(process.stdout, width * height)
                with self._condition:
                    if not self._closed:
                        self._latest = (mask, width, height, captured_at)
        except (OSError, EOFError, ValueError, struct.error):
            with self._condition:
                if not self._closed:
                    self.error = 'Person mask helper unavailable'
                self._latest = self._pending = None
        finally:
            if process is not None:
                self._terminate(process)

    @staticmethod
    def _terminate(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=0.5)
        for pipe in (process.stdin, process.stdout):
            if pipe is not None:
                pipe.close()

    def close(self):
        with self._condition:
            self._closed = True
            self._pending = self._latest = None
            process = self._process
            self._condition.notify()
        # Break a blocked pipe read, then let the worker release its resources.
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=0.5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=0.5)
        self._thread.join(timeout=0.5)
