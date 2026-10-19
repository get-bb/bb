#!/usr/bin/env bash
set -euo pipefail

version="${BUN_VERSION:?BUN_VERSION is required}"
action_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checksums="${action_dir}/bun-${version}.sha256"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="bun-linux-x64-baseline.zip" ;;
  Linux-aarch64 | Linux-arm64) asset="bun-linux-aarch64.zip" ;;
  Darwin-arm64) asset="bun-darwin-aarch64.zip" ;;
  Darwin-x86_64) asset="bun-darwin-x64-baseline.zip" ;;
  MINGW*-x86_64 | MSYS*-x86_64) asset="bun-windows-x64-baseline.zip" ;;
  *) echo "::error::Unsupported Bun platform $(uname -s)-$(uname -m)."; exit 1 ;;
esac
expected="$(awk -v asset="${asset}" '$2 == asset { print $1 }' "${checksums}")"
if [[ -z "${expected}" ]]; then
  echo "::error::No committed checksum for ${asset} at Bun ${version}."
  exit 1
fi
checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum < "$1" | awk '{ print $1 }'
  else
    shasum -a 256 < "$1" | awk '{ print $1 }'
  fi
}
install_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/bb-bun-${version}"
mkdir -p "${install_dir}"
archive="${install_dir}/archive.zip"
if [[ -f "${archive}" && "$(checksum "${archive}")" == "${expected}" ]]; then
  echo "Reusing checksum-verified Bun ${version} archive."
else
  rm -f "${archive}"
  download="${archive}.download"
  trap 'rm -f "${download}"' EXIT
  curl --fail --silent --show-error --location \
    --retry 2 --retry-all-errors --retry-delay 2 --retry-max-time 120 \
    --connect-timeout 10 --max-time 45 \
    --output "${download}" \
    "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}"
  actual="$(checksum "${download}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "::error::sha256 mismatch for ${asset}: expected ${expected}, got ${actual}."
    exit 1
  fi
  mv "${download}" "${archive}"
fi
extract_dir="${install_dir}/extracted"
rm -rf "${extract_dir}"
mkdir -p "${extract_dir}"
if [[ "${asset}" == bun-windows-* ]]; then
  export BB_BUN_ARCHIVE="${archive}" BB_BUN_EXTRACT_DIR="${extract_dir}"
  powershell -NoProfile -NonInteractive -Command 'Expand-Archive -LiteralPath $env:BB_BUN_ARCHIVE -DestinationPath $env:BB_BUN_EXTRACT_DIR -Force'
  binary="${extract_dir}/${asset%.zip}/bun.exe"
else
  unzip -q "${archive}" -d "${extract_dir}"
  binary="${extract_dir}/${asset%.zip}/bun"
  chmod +x "${binary}"
fi
actual_version="$("${binary}" --version | tr -d '\r')"
if [[ "${actual_version}" != "${version}" ]]; then
  echo "::error::Expected Bun ${version}, got ${actual_version}."
  exit 1
fi
echo "$(dirname "${binary}")" >> "${GITHUB_PATH:?GITHUB_PATH is required}"
echo "Installed Bun ${actual_version}."
