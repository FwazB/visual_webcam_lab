#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$root/../.." && pwd)
fuzz="$repo/touchdesigner/fuzz"
sensor="$fuzz/headphones/.build/Fuzz Head Motion.app"
output="$root/.build/Body Synth Motion.app"
mkdir -p "$root/.build"
stage=$(mktemp -d "$root/.build/staging.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT

if [ ! -d "$sensor" ]; then sh "$fuzz/headphones/build.sh"; fi
/usr/bin/codesign --verify --strict "$sensor"
app="$stage/Body Synth Motion.app"
resources="$app/Contents/Resources"
mkdir -p "$app/Contents/MacOS" "$resources/scripts" "$resources/touchdesigner/fuzz/headphones/.build"
cp "$root/Info.plist" "$app/Contents/Info.plist"
cp "$repo/scripts/head-motion.py" "$resources/scripts/"
cp "$fuzz/head_tilt.py" "$resources/touchdesigner/fuzz/"
/usr/bin/ditto "$sensor" "$resources/touchdesigner/fuzz/headphones/.build/Fuzz Head Motion.app"
/usr/bin/xcrun --sdk macosx swiftc -O -target "$(uname -m)-apple-macosx14.0" \
    "$root/WebsiteBridge.swift" "$root/MotionApp.swift" -o "$app/Contents/MacOS/BodySynthMotion"
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --deep --strict "$app"
if [ -d "$output" ]; then mv "$output" "$stage/previous.app"; fi
if ! mv "$app" "$output"; then
    if [ -d "$stage/previous.app" ]; then mv "$stage/previous.app" "$output"; fi
    exit 1
fi
printf 'Built %s\n' "$output"
