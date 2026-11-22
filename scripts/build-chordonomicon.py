"""Rebuild the lazy Spotify-ID lookup with Python 3, optionally from --csv PATH."""

import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
from urllib.request import urlopen


DATASET = "https://huggingface.co/datasets/ailsntua/Chordonomicon"
REVISION = "f3a8b678bd65639c01caa342921733f1db01be23"
CSV_SHA256 = "9d2f4ccdc876a4e816712f128e4772b2af558c2a2923cce5be3a0364fbad9a8d"
CSV_URL = f"{DATASET}/resolve/{REVISION}/chordonomicon_v2.csv"
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "chord-charts" / "chordonomicon"
TRACK_ID = re.compile(r"[0-9A-Za-z]{22}")


def shard_number(track_id):
    value = 0
    for char in track_id:
        value = (31 * value + ord(char)) & 255
    return value


def build(source, output):
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if digest.hexdigest() != CSV_SHA256:
        raise ValueError("Source CSV does not match the pinned Chordonomicon v2 release")

    shards = [{} for _ in range(256)]
    rows = matched = 0
    with source.open(encoding="utf-8", newline="") as stream:
        for item in csv.DictReader(stream):
            rows += 1
            track = item["spotify_song_id"]
            chords = item["chords"].strip()
            if not TRACK_ID.fullmatch(track) or not chords:
                continue
            matched += 1
            # For multiple community charts of one recording, keep the first in this fixed release.
            shards[shard_number(track)].setdefault(track, chords)

    output.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    for number, shard in enumerate(shards):
        body = json.dumps(shard, separators=(",", ":"), sort_keys=True).encode("utf-8")
        destination = output / f"{number:02x}.json.gz"
        with destination.open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as zipped:
                zipped.write(body)
        total_bytes += destination.stat().st_size

    manifest = {
        "name": "Chordonomicon",
        "source": DATASET,
        "revision": REVISION,
        "sourceSha256": CSV_SHA256,
        "paper": "https://doi.org/10.48550/arXiv.2410.22046",
        "authors": [
            "Spyridon Kantarelis", "Ioannis Liolitsas", "Konstantinos Thomas",
            "Vassilis Lyberatos", "Edmund Dervakos", "Giorgos Stamou",
        ],
        "license": "CC BY-NC 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc/4.0/",
        "adaptation": "Indexed by Spotify track ID. Includes the first nonempty chart for each exact ID in the release. "
                      "Section tags and chord symbols retain the source order. The source supplies no beat durations.",
        "sourceRows": rows,
        "rowsWithTrackAndChart": matched,
        "uniqueTracks": sum(len(shard) for shard in shards),
        "shards": len(shards),
        "compressedBytes": total_bytes,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{manifest['uniqueTracks']:,} track charts, {total_bytes:,} compressed bytes")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, help="Use a previously downloaded copy of the pinned CSV.")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    args = parser.parse_args()
    if args.csv is not None:
        build(args.csv, args.output_dir)
        return
    with tempfile.TemporaryDirectory() as temporary:
        source = Path(temporary) / "chordonomicon_v2.csv"
        with urlopen(CSV_URL, timeout=90) as response, source.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        build(source, args.output_dir)


if __name__ == "__main__":
    main()
