"""Fetch public, checksum-pinned ONNX archives; never use account tokens."""
import hashlib, io, json, pathlib, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parent
MODELS = [
    ("detector", "rtmdet_nano_8xb32-300e_hand-267f9c8f.zip", "9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402"),
    ("pose", "rtmpose-m_simcc-hand5_pt-aic-coco_210e-256x256-74fb594_20230320.zip", "45c9e1aa21b8fe33859973c49bce4647645d312e7a226e398a42f9137d44a56d"),
]
def main():
    target = ROOT / "models"
    target.mkdir(exist_ok=True)
    receipts = []
    for name, archive, checksum in MODELS:
        url = "https://huggingface.co/Tau-J/RTMPose/resolve/main/rtmposev1/onnx_sdk/" + archive
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(120_000_001)
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError("Archive checksum mismatch: " + archive)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            choices = [i for i in z.infolist() if i.filename.endswith(".onnx")]
            if len(choices) != 1 or choices[0].file_size > 120_000_000:
                raise ValueError("Unexpected model archive")
            model = z.read(choices[0])
            (target / (name + ".onnx")).write_bytes(model)
            receipts.append(dict(name=name, source=url, archive_sha256=checksum,
                model_sha256=hashlib.sha256(model).hexdigest(), bytes=len(model)))
            print(name, len(model), "bytes verified; archive entries:", z.namelist())
    (target / "receipt.json").write_text(json.dumps(receipts, indent=2) + "\n")
if __name__ == "__main__":
    main()
