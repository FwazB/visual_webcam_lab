#!/bin/sh
set -eu

BUILD_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$BUILD_DIRECTORY/.build"
xcrun swiftc -O -framework Vision -framework CoreVideo \
  "$BUILD_DIRECTORY/person_mask.swift" -o "$BUILD_DIRECTORY/.build/person-mask"
