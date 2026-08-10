#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(dirname -- "${script_dir}")"
DESKTOP_DIR="${REPO_ROOT}/apps/desktop"
RELEASE_DIR="${DESKTOP_DIR}/release"
APP_NAME="bb"
APP_BUNDLE_NAME="${APP_NAME}.app"
INSTALL_PATH="/Applications/${APP_BUNDLE_NAME}"
PACKAGED_APP_PATH="${RELEASE_DIR}/mac-arm64/${APP_BUNDLE_NAME}"

SKIP_BUILD=0
NO_QUIT=0

usage() {
  cat <<'EOF'
Usage:
  scripts/desktop-build-install.sh [--skip-build] [--no-quit]

Builds the stable macOS desktop app (including a .dmg), then replaces
/Applications/bb.app with the freshly built bundle.

Options:
  --skip-build  Install from existing apps/desktop/release artifacts only
  --no-quit     Skip quitting a running bb app before replacing the install
EOF
}

log() {
  printf '[desktop-install] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --skip-build)
        SKIP_BUILD=1
        ;;
      --no-quit)
        NO_QUIT=1
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
    shift
  done
}

assert_platform() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "This script only runs on macOS"
  fi
  if [[ "$(uname -m)" != "arm64" ]]; then
    die "This script only supports Apple Silicon (arm64)"
  fi
}

assert_node_version() {
  require_command node
  node - <<'NODE' || die "Node >=22.19.0 is required"
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const ok =
  major > 22 ||
  (major === 22 && (minor > 19 || (minor === 19 && patch >= 0)));
if (!ok) {
  process.exit(1);
}
NODE
}

ensure_dependencies() {
  if [[ ! -x "${REPO_ROOT}/node_modules/.bin/turbo" ]]; then
    log "Installing workspace dependencies"
    pnpm -C "${REPO_ROOT}" install --frozen-lockfile
  fi

  log "Checking native Node modules"
  node "${REPO_ROOT}/scripts/ensure-native-modules.mjs"

  if ! (cd "${DESKTOP_DIR}" && node -e "require('electron')" >/dev/null 2>&1); then
    local electron_install
    electron_install="$(
      find "${REPO_ROOT}/node_modules/.pnpm" -path '*/node_modules/electron/install.js' -type f -print -quit
    )"
    [[ -n "${electron_install}" ]] || die "Could not find Electron install.js"
    log "Installing Electron runtime"
    node "${electron_install}"
  fi
}

build_desktop() {
  log "Building desktop artifacts"
  pnpm -C "${REPO_ROOT}" exec turbo run desktop:dist:local \
    --filter=@bb/desktop \
    --force \
    --output-logs=new-only
}

read_desktop_version() {
  node - "${DESKTOP_DIR}/package.json" <<'NODE'
const fs = require("node:fs");
const packageJsonPath = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
  process.exit(1);
}
process.stdout.write(packageJson.version);
NODE
}

resolve_dmg_path() {
  local version="$1"
  local dmg_path="${RELEASE_DIR}/${APP_NAME}-${version}-arm64.dmg"
  [[ -f "${dmg_path}" ]] || die "DMG not found at ${dmg_path}"
  printf '%s\n' "${dmg_path}"
}

assert_packaged_app() {
  [[ -d "${PACKAGED_APP_PATH}" ]] || die "Packaged app not found at ${PACKAGED_APP_PATH}"
}

quit_running_app() {
  if [[ "${NO_QUIT}" -eq 1 ]]; then
    return 0
  fi

  if ! pgrep -xq "${APP_NAME}"; then
    return 0
  fi

  log "Quitting running ${APP_NAME}"
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true

  local elapsed=0
  while pgrep -xq "${APP_NAME}" && ((elapsed < 10)); do
    sleep 1
    elapsed=$((elapsed + 1))
  done

  if pgrep -xq "${APP_NAME}"; then
    log "App still running; sending SIGTERM"
    pkill -x "${APP_NAME}" || true
    sleep 1
  fi

  if pgrep -xq "${APP_NAME}"; then
    die "Could not quit running ${APP_NAME}; close it manually and retry"
  fi
}

install_app() {
  if [[ -d "${INSTALL_PATH}" ]]; then
    log "Removing existing install at ${INSTALL_PATH}"
    rm -rf "${INSTALL_PATH}"
  fi

  log "Installing ${APP_BUNDLE_NAME} to /Applications"
  ditto "${PACKAGED_APP_PATH}" "${INSTALL_PATH}"
}

main() {
  parse_args "$@"
  assert_platform
  assert_node_version
  require_command pnpm
  require_command ditto
  require_command osascript

  if [[ "${SKIP_BUILD}" -eq 0 ]]; then
    ensure_dependencies
    build_desktop
  fi

  local version dmg_path
  version="$(read_desktop_version)" || die "Could not read apps/desktop/package.json version"
  assert_packaged_app
  dmg_path="$(resolve_dmg_path "${version}")"

  quit_running_app
  install_app

  log "Installed ${INSTALL_PATH}"
  log "DMG artifact: ${dmg_path}"
}

main "$@"
