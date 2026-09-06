# `.sh` → `.ps1` inventory (native Windows)

The repo holds 7 `.sh` scripts (excluding `node_modules`). None is deleted:
macOS and Linux remain first-class platforms. Only the ones a QA needs on
Windows get a `.ps1` twin, and they live under `qa/scripts/` because the root
`scripts/` belongs to S7, `apps/desktop` belongs to S6, and the rest belongs to
other teams: a twin placed next to the original `.sh` would be an out-of-scope
edit and a guaranteed merge conflict. If the coordinator prefers sibling twins
(`foo.ps1` next to `foo.sh`), these files are ready to move.

Verification status: **reviewed line by line, NOT executed**. This Ubuntu VPS
has no PowerShell (`command -v pwsh powershell` returns nothing), so no `.ps1`
in this repo can be tested here. Windows truth comes from the `windows-latest`
runner (`win-native.yml`).

## Table

| `.sh` | What it does | Needed on Windows? | Twin / decision |
|---|---|---|---|
| `.bb-env-setup.sh` | Provisions the dev environment: checks `pnpm` and `package.json`, runs `pnpm install` without aborting on the first failure | **Yes**: it is the "install dependencies" step of QA on Windows | `qa/scripts/bb-env-setup.ps1`, 1:1 equivalence verified by reading |
| `scripts/provider-corpus/snapshot-rows.sh` | Provider-corpus gates: `compare` (default) or `write`, requires `BB_PROVIDER_CORPUS_DIR` with `manifest.json`, runs `turbo run test:provider-corpus --filter=@bb/server`, dumps `rows-last-run.json` and `perf-last-run.md` | **Yes**: the corpus gates also run from Windows | `qa/scripts/snapshot-rows.ps1`, same interface (`write`/`compare`), same environment variables, same output files |
| `check.sh` | Squad wrapper: a single `turbo` at a time across the whole VPS (global `flock` lock, `nice`, `--concurrency=1`) | **No**: coordinator tooling for this Ubuntu VPS (`flock`, `bash`); the Windows runner does not use it | No twin |
| `.github/actions/setup-workspace/install-pnpm.sh` | Installs the pinned pnpm binary on Linux/macOS runners (download + sha256) with `bash`, `curl`, `sha256sum`/`shasum` | **No**: on Windows the runner uses `corepack prepare pnpm --activate` (see `win-native.yml`, "Set up pnpm" step). A twin would duplicate the path | No twin. Owner: S7 (CI) |
| `apps/mobile/e2e/scripts/ci-run-flows.sh` | Runs Maestro flows against an iOS simulator (`xcrun simctl`, Release app + backend) | **No**: requires macOS (simulator) and the Maestro/Java toolchain; neither executable nor meaningful on Windows | No twin |
| `apps/server/src/assets/install-machine.sh` | Enrolls a macOS/Linux machine (launchd/systemd): downloads `bb-app.tgz`, verifies sha256, registers the service | **No from QA**: Windows enrollment is product surface (NSIS installer + Windows service), not a twin of this script. It also literally says `supports macOS and Linux only` | No twin. Needs coordination: daemon/desktop teams for the real Windows path |
| `scripts/provider-recordings/convert-claude-transcripts-sample.sh` | Rebuilds fixtures from private `~/.claude/projects` transcripts with `mktemp`, `trap`, `find` | **No**: one-shot dev tool with private data; the S7 line decides whether it wants a twin | No twin. Owner: S7 |

## New files in `qa/scripts/`

| File | Source | Notes |
|---|---|---|
| `bb-env-setup.ps1` | Twin of `.bb-env-setup.sh` | Deliberate difference #1: resolves the repo root from `$PSScriptRoot` instead of assuming the CWD (on Windows it is usually launched by double click or from another folder). Deliberate difference #2: `pnpm install` is invoked as explicit `pnpm.cmd` so it does not depend on PATHEXT resolution. Everything else (`[bb-env-setup]` prefix, continuing past a failed step while warning with the exit code) is identical |
| `snapshot-rows.ps1` | Twin of `scripts/provider-corpus/snapshot-rows.sh` | Same interface (`-Mode compare|write`, `compare` by default), same env (`BB_PROVIDER_CORPUS_DIR`, `BB_PROVIDER_CORPUS_ALLOWLIST`, `BB_PROVIDER_CORPUS_SNAPSHOT_DIR`, `BB_PROVIDER_CORPUS_ROW_CLASSES`, `BB_PROVIDER_CORPUS_SNAPSHOT`), same `turbo run test:provider-corpus --filter=@bb/server`, same dumps. `set -euo pipefail` translates to `$ErrorActionPreference = 'Stop'` + an explicit `$LASTEXITCODE` check after every native command |
| `collect-evidence.ps1` | New, no prior `.sh` | Collects locally the same thing the workflow collects in CI: `00-host.txt` (OS, node, PowerShell) and `90-tasklist.txt` + `91-processes.csv`. The `10/20/30/40-*.txt` files are produced by re-running the commands documented in `qa-evidence/README.md` with `Tee-Object` |

`.gitattributes` already forces CRLF on `*.ps1`: nothing to configure when
adding these files.
