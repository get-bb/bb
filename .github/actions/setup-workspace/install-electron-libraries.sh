#!/usr/bin/env bash
set -euo pipefail

packages=(xvfb libgtk-3-0t64 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2t64)
missing=()
for package in "${packages[@]}"; do
  if [[ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" != 'install ok installed' ]]; then
    missing+=("$package")
  fi
done
if [[ ${#missing[@]} -eq 0 ]]; then
  echo "Electron runtime libraries are already installed."
  exit 0
fi
sudo apt-get update
sudo apt-get install -y --no-install-recommends "${missing[@]}"
