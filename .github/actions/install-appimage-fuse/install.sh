#!/usr/bin/env bash
set -euo pipefail

package="${FUSE_PACKAGE:?FUSE_PACKAGE is required}"
if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" == 'install ok installed' ]]; then
  echo "$package is already installed."
  exit 0
fi

codename=$(lsb_release -cs)
architecture=$(dpkg --print-architecture)
mirrors=(https://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu)
if [[ "$architecture" != amd64 && "$architecture" != i386 ]]; then
  mirrors=(https://ports.ubuntu.com/ubuntu-ports)
fi

work=$(mktemp -d)
chmod 755 "$work"
trap 'sudo rm -rf "$work"' EXIT
apt_options=(
  -o "Dir::Etc::sourcelist=$work/sources.list"
  -o Dir::Etc::sourceparts=-
  -o "Dir::State::lists=$work/lists"
  -o APT::Update::Error-Mode=any
  -o Acquire::http::Timeout=10
  -o Acquire::https::Timeout=10
  -o Acquire::Retries=1
  -o Acquire::IndexTargets::deb::DEP-11::DefaultEnabled=false
)

for mirror in "${mirrors[@]}"; do
  sudo rm -rf "$work/lists"
  mkdir -p "$work/lists/partial"
  for pocket in "$codename" "$codename-updates" "$codename-security"; do
    printf 'deb [arch=%s] %s %s main universe\n' "$architecture" "$mirror" "$pocket"
  done > "$work/sources.list"
  if sudo apt-get "${apt_options[@]}" update &&
    sudo apt-get "${apt_options[@]}" install --yes --no-install-recommends "$package"; then
    exit 0
  fi
  echo "::warning::FUSE installation from $mirror failed."
done

echo "::error::Could not install $package from any Ubuntu mirror."
exit 1
