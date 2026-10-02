#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
architecture="${1:-arm64-v8a}"
case "$architecture" in
  arm64-v8a|x86_64) ;;
  *) echo "Usage: build-android-local.sh [arm64-v8a|x86_64]" >&2; exit 1 ;;
esac

pnpm exec expo prebuild --platform android --no-install
(
  cd android
  ./gradlew app:assembleRelease "-PreactNativeArchitectures=$architecture" --max-workers=4
)
mkdir -p build-output
cp android/app/build/outputs/apk/release/app-release.apk build-output/bb-android-local.apk
echo "Local test APK (debug signing key): apps/mobile/build-output/bb-android-local.apk"
