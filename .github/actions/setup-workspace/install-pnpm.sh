#!/usr/bin/env bash
set -euo pipefail

version="${PNPM_VERSION:?PNPM_VERSION is required}"
action_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checksums="${action_dir}/pnpm-${version}.sha256"
package_manager="$(node --print 'require(process.argv[1]).packageManager' "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}/package.json")"

if [[ "${package_manager}" != "pnpm@${version}" ]]; then
  echo "::error::pnpm version mismatch: package.json declares ${package_manager#pnpm@}, but the action requested ${version}."
  exit 1
fi

if [[ ! -f "${checksums}" ]]; then
  echo "::error::No checksums for pnpm ${version}. Download the release assets from https://github.com/pnpm/pnpm/releases/tag/v${version}, run sha256sum on them, and commit the output as ${checksums}."
  exit 1
fi

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) asset="pnpm-linux-x64" ;;
  Linux-aarch64 | Linux-arm64) asset="pnpm-linux-arm64" ;;
  Darwin-arm64) asset="pnpm-macos-arm64" ;;
  Darwin-x86_64) asset="pnpm-macos-x64" ;;
  *)
    echo "::error::Unsupported runner platform $(uname -s)-$(uname -m) for the pnpm release binary."
    exit 1
    ;;
esac

expected="$(awk -v asset="${asset}" '$2 == asset { print $1 }' "${checksums}")"
if [[ -z "${expected}" ]]; then
  echo "::error::${checksums} has no entry for ${asset}."
  exit 1
fi

install_dir="${RUNNER_TEMP:-/tmp}/pnpm-${version}"
mkdir -p "${install_dir}/bin"
binary="${install_dir}/bin/pnpm"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

url="https://github.com/pnpm/pnpm/releases/download/v${version}/${asset}"
if [[ -f "${binary}" && "$(checksum "${binary}")" == "${expected}" ]]; then
  echo "Reusing checksum-verified pnpm ${version}."
else
  rm -f "${binary}"
  download="${binary}.download"
  trap 'rm -f "${download}"' EXIT
  curl --fail --silent --show-error --location \
    --retry 2 --retry-all-errors --retry-delay 2 --retry-max-time 120 \
    --connect-timeout 10 --max-time 60 \
    --output "${download}" "${url}"
  actual="$(checksum "${download}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "::error::sha256 mismatch for ${asset}: expected ${expected}, got ${actual}."
    exit 1
  fi
  mv "${download}" "${binary}"
fi

chmod +x "${binary}"
ln -sf pnpm "${install_dir}/bin/pnpx"
echo "${install_dir}/bin" >> "${GITHUB_PATH}"
echo "PNPM_HOME=${install_dir}/bin" >> "${GITHUB_ENV}"
echo "Installed pnpm $("${binary}" --version) from ${url}"
