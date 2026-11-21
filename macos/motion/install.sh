#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dest="$HOME/Applications/Body Synth Motion.app"
register=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [ -e "$dest" ] || [ -L "$dest" ]; then
    id=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$dest/Contents/Info.plist" 2>/dev/null || true)
    if [ "$id" != "com.bodysynth.Motion" ] || [ -L "$dest" ]; then
        printf 'The install path is already in use: %s\n' "$dest" >&2
        exit 1
    fi
fi
sh "$root/build.sh"
mkdir -p "$HOME/Applications"
stage=$(mktemp -d "$HOME/Applications/.body-synth-install.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
/usr/bin/ditto "$root/.build/Body Synth Motion.app" "$stage/Body Synth Motion.app"
/usr/bin/codesign --verify --deep --strict "$stage/Body Synth Motion.app"
if [ -d "$dest" ]; then mv "$dest" "$stage/previous.app"; fi
if ! mv "$stage/Body Synth Motion.app" "$dest"; then
    if [ -d "$stage/previous.app" ]; then mv "$stage/previous.app" "$dest"; fi
    exit 1
fi
if ! "$register" -f "$dest"; then
    mv "$dest" "$stage/unregistered.app"
    if [ -d "$stage/previous.app" ]; then
        mv "$stage/previous.app" "$dest"
        "$register" -f "$dest" || true
    fi
    printf 'Could not register Body Synth Motion with Launch Services.\n' >&2
    exit 1
fi
printf 'Installed %s\nUse Start AirPods on the Body Synth website.\n' "$dest"
