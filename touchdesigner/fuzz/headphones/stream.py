#!/usr/bin/python3
"""Relay the independent Mac app to the parent process's stdout pipe."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import tempfile


def status(message):
    print(json.dumps({"status": message}), flush=True)


def stop(signum, frame):
    raise SystemExit(0)


def main():
    args = sys.argv[1:]
    if args not in ([], ["--probe"]):
        status("Unknown Mac headphone motion option.")
        return 2
    owner = os.getppid()
    if owner == 1 or (select.select([0], [], [], 0)[0] and not os.read(0, 1)):
        return 0
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)
    bundle = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="fuzz-head-motion-") as directory:
        fifo = Path(directory) / "motion"
        os.mkfifo(fifo, 0o600)
        # Launch Services gives the sensor its own app identity for the macOS
        # permission dialog. Keep the pipe writable until the app has opened it.
        with fifo.open("rb+", buffering=0) as reader:
            launch = subprocess.Popen(
                ["/usr/bin/open", "-n", "-g", "-W", "--stdout", str(fifo), str(bundle),
                 "--args", "--probe" if args else "--session", str(os.getpid())],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                while os.getppid() == owner:
                    ready, _, _ = select.select([0, reader], [], [], 0.2)
                    if 0 in ready and not os.read(0, 4096):
                        return 0
                    if reader in ready:
                        data = reader.read(8192)
                        view = memoryview(data)
                        while view:
                            view = view[os.write(1, view):]
                    elif launch.poll() is not None:
                        if launch.returncode:
                            status("Could not launch Fuzz Head Motion on this Mac.")
                        return launch.returncode
            finally:
                if launch.poll() is None:
                    launch.terminate()
                    launch.wait()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        pass
    except OSError:
        status("Could not open the Mac headphone motion helper.")
        raise SystemExit(1)
