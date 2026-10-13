#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "Usage: build-android-dev.sh [arm64-v8a|x86_64]" >&2
  exit 1
fi
exec bash "$(dirname "$0")/build-android-local.sh" "${1:-arm64-v8a}" dev
