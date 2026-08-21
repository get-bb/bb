#!/usr/bin/env bash
# Run the provider-corpus gates (row snapshots + timeline perf baseline).
#
#   scripts/provider-corpus/snapshot-rows.sh compare   # default: fail on any
#                                                      # diff not in allowlist
#   scripts/provider-corpus/snapshot-rows.sh write     # mint a new baseline
#
# Requires BB_PROVIDER_CORPUS_DIR (defaults to ~/.bb/provider-corpus when that
# directory exists). See docs/debugging-and-qa.md, "Provider corpus".
set -euo pipefail

mode="${1:-compare}"
case "${mode}" in
  write|compare) ;;
  *)
    echo "usage: $0 [write|compare]" >&2
    exit 2
    ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd -- "${script_dir}/../.." && pwd -P)"

if [[ -z "${BB_PROVIDER_CORPUS_DIR:-}" && -f "${HOME}/.bb/provider-corpus/manifest.json" ]]; then
  export BB_PROVIDER_CORPUS_DIR="${HOME}/.bb/provider-corpus"
fi
if [[ -z "${BB_PROVIDER_CORPUS_DIR:-}" || ! -f "${BB_PROVIDER_CORPUS_DIR}/manifest.json" ]]; then
  echo "BB_PROVIDER_CORPUS_DIR must point at a corpus directory with manifest.json" >&2
  exit 2
fi

export BB_PROVIDER_CORPUS_SNAPSHOT="${mode}"
cd "${repo_root}"
pnpm exec turbo run test:provider-corpus --filter=@bb/server

snapshots_dir="${BB_PROVIDER_CORPUS_DIR}/snapshots"
if [[ -f "${snapshots_dir}/rows-last-run.json" ]]; then
  echo
  echo "Row snapshots: ${snapshots_dir}/rows-last-run.json"
  cat "${snapshots_dir}/rows-last-run.json"
fi
if [[ -f "${snapshots_dir}/perf-last-run.md" ]]; then
  echo
  echo "Timeline perf: ${snapshots_dir}/perf-last-run.md"
  cat "${snapshots_dir}/perf-last-run.md"
fi
