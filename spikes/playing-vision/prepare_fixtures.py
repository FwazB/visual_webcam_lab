"""Public test image plus synthetic audio. Not an accuracy benchmark."""
import hashlib, pathlib, subprocess, urllib.request
root = pathlib.Path(__file__).resolve().parent
folder = root / "private"
folder.mkdir(exist_ok=True)
url = "https://raw.githubusercontent.com/open-mmlab/mmpose/main/tests/data/onehand10k/9.jpg"
with urllib.request.urlopen(url, timeout=30) as response:
    data = response.read()
if hashlib.sha256(data).hexdigest() != "3943863e90a6e31b6e9398ce5c6fb319069f5243aa7758f0deab97a9d760cf5b":
    raise ValueError("Fixture checksum changed")
image = folder / "hand-fixture.jpg"
image.write_bytes(data)
subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", str(image),
    "-f", "lavfi", "-i", "sine=frequency=55:sample_rate=48000", "-t", "4", "-vf",
    "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2",
    "-r", "15", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(folder / "hand-tone.mp4")], check=True)
print("Private fixtures ready; do not publish them as product assets.")
