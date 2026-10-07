#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [ "$#" -gt 2 ]; then
  echo "Usage: build-android-local.sh [arm64-v8a|x86_64] [production|dev]" >&2
  exit 1
fi
architecture="${1:-arm64-v8a}"
variant="${2:-production}"
case "$architecture" in
  arm64-v8a|x86_64) ;;
  *) echo "Usage: build-android-local.sh [arm64-v8a|x86_64]" >&2; exit 1 ;;
esac
case "$variant" in
  production) apk_name=bb-android-local.apk ;;
  dev) apk_name=bb-dev.apk ;;
  *) echo "Usage: build-android-local.sh [arm64-v8a|x86_64] [production|dev]" >&2; exit 1 ;;
esac
export BB_MOBILE_VARIANT="$variant"
mkdir -p build-output
if ! mkdir build-output/.android-build-lock 2>/dev/null; then
  echo "An Android build is already running in this checkout. If it was interrupted, remove apps/mobile/build-output/.android-build-lock before retrying." >&2
  exit 1
fi
trap 'rmdir build-output/.android-build-lock' EXIT
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
if [ -z "${ANDROID_HOME:-}" ] && [ -d "$HOME/Library/Android/sdk" ]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi

pnpm exec expo prebuild --platform android --no-install --clean
(
  cd android
  ./gradlew app:assembleRelease "-PreactNativeArchitectures=$architecture" --max-workers=4
)
mkdir -p build-output
cp android/app/build/outputs/apk/release/app-release.apk "build-output/$apk_name"
echo "Local test APK (debug signing key): $(pwd)/build-output/$apk_name"
