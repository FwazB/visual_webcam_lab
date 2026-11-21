#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output="$root/.build/Fuzz Head Motion.app"
mkdir -p "$root/.build"
stage=$(mktemp -d "$root/.build/staging.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
app="$stage/Fuzz Head Motion.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$root/Info.plist" "$app/Contents/Info.plist"
cp "$root/stream.py" "$app/Contents/Resources/stream.py"
chmod 755 "$app/Contents/Resources/stream.py"
ln -s ../Resources/stream.py "$app/Contents/MacOS/FuzzHeadMotion"

xcrun --sdk macosx swiftc -O -target "$(uname -m)-apple-macosx14.0" \
    "$root/sensor.swift" -o "$app/Contents/MacOS/FuzzHeadMotionSensor"
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --strict "$app"
if [ -d "$output" ]; then mv "$output" "$stage/previous.app"; fi
if ! mv "$app" "$output"; then
    if [ -d "$stage/previous.app" ]; then mv "$stage/previous.app" "$output"; fi
    exit 1
fi
printf 'Built %s\n' "$output"
