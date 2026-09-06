# qa-evidence — what is collected and where

`qa-evidence/` is the single folder where all Windows proof lands: what CI
uploads as an artifact and what the `qa/CHECKLIST-WIN11.md` human attaches. It
is never committed (it is output, not source); the workflow generates it from
scratch on every run.

## Runner files (`windows-latest`, `win-native.yml`)

The `probe` job runs every step with `continue-on-error` and only the final
gate fails the job, so one pass returns the full failure surface. Each step
dumps to its file with `Tee-Object`:

| File | Step that produces it | What it proves |
|---|---|---|
| `00-host.txt` | Host facts | Exact OS (`Caption`, `Version`, `OSArchitecture`), `node -p "process.version + ..."` and `$PSVersionTable`. Without this the rest is uninterpretable |
| `10-install.txt` | `pnpm install --frozen-lockfile` | Dependency install on real Windows |
| `20-typecheck.txt` | `pnpm run typecheck` | Types on real Windows |
| `30-tests.txt` | `vitest run packages/domain packages/process-utils apps/host-daemon apps/desktop` | Unit tests that decide Windows behaviour by injected platform |
| `40-build.txt` | `pnpm run build` | The build does not break on win32 |
| `90-tasklist.txt` | Process snapshot (`tasklist /FO TABLE`, always) | Which processes were still alive at the end of the job |

The workflow uploads them as the `win-probe-evidence-<run_number>` artifact
with 30-day retention. The job summary paints `install / typecheck / tests /
build` with ✅/❌.

## Human files (`CHECKLIST-WIN11.md` pass)

| File | Step | What it proves |
|---|---|---|
| `qa-evidence\10/20/30/40-*.txt` | Checklist 1–2 | Same as CI, but from your machine (covers "fails on my Windows" when the runner is green) |
| `50-first-window.png` | Checklist 4 | Native Electron window, no browser |
| `90-tasklist.txt` + `91-processes.csv` | Checklist 7 | Empty `bb`/`electron` `tasklist` and `Get-Process` after closing: proof of clean shutdown |
| `92-tasklist-after-uninstall.txt` | Checklist 8 | Post-uninstall `tasklist` + note of what was left under `%APPDATA%` / `%LOCALAPPDATA%` |
| Screenshots of any SmartScreen / NSIS / error you see | The step where it shows up | Always with the window text legible; crop only the sensitive area |

## How to generate them locally

```powershell
qa\scripts\collect-evidence.ps1
qa\scripts\collect-evidence.ps1 -OutDir C:\bb-test\evidencia
```

Writes `00-host.txt`, `90-tasklist.txt` and `91-processes.csv` to the given
folder (`qa-evidence/` by default). The `10/20/30/40` logs come from running
the checklist commands with `Tee-Object`, same as the workflow. Screenshots
use `Win+Shift+S` or the Snipping Tool and are saved as `.png` under the table
names.

## Rules

- One `FAIL` invalidates the whole pass; verdicts are never averaged.
- Every evidence file is cited in the PR with the checklist step it belongs
  to. Evidence with no associated step does not count.
- If the runner is green and your machine is red (or vice versa), open an
  issue with both `00-host.txt` files side by side: the first hypothesis is
  always an environment difference, not a code difference.
