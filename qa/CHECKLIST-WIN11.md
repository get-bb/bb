# Manual QA checklist — native bb on real Windows 11

One human, one real Windows 11 x64 machine, physical or VM with a GUI, no WSL
involved. Each step says what to do and what you expect to see; if what you
observe differs, it is a failure and goes to the PR with its evidence
(`qa-evidence/README.md` says where).

Before you start:

- Updated Windows 11 x64, normal user session (not SYSTEM).
- Node.js `22.19.0` and pnpm `9.15.0` if you are running steps 1–2 from source
  (these are the versions pinned in `win-native.yml`); not needed for the
  installer.
- Folder `C:\bb-test`: create it with 3–4 text files (`nota.txt`,
  `datos.csv`, one with an eñe: `diseño.txt`). Deliberately no git inside: step 6
  must work with a plain folder.
- Decide where this pass's evidence goes: the checkout's `qa-evidence/` or
  a separate folder (`collect-evidence.ps1 -OutDir C:\bb-test\evidencia`).

## 1. Install dependencies (only if validating from source)

```powershell
pnpm install --frozen-lockfile 2>&1 | Tee-Object qa-evidence\10-install.txt
```

- Expected: `pnpm install` exits 0. No `ELIFECYCLE` errors, no red `node-gyp`.
  Yellow peer-dep warnings: acceptable, attach them.
- Alternative via the QA twin: `qa\scripts\bb-env-setup.ps1` (same effect,
  log with a `[bb-env-setup]` prefix).
- Evidence: `qa-evidence\10-install.txt`.

## 2. Typecheck + tests + build (from source only)

```powershell
pnpm run typecheck 2>&1 | Tee-Object qa-evidence\20-typecheck.txt
pnpm exec vitest run --reporter=basic packages/domain packages/process-utils apps/host-daemon apps/desktop 2>&1 | Tee-Object qa-evidence\30-tests.txt
pnpm run build 2>&1 | Tee-Object qa-evidence\40-build.txt
```

- Expected: all three exit 0. In `30-tests.txt`, zero `FAIL`; note the
  `Test Files / Tests` counts at the end of the file.
- If anything fails here, do not move on to the installer: open an issue with
  these three files (see the repo's `docs/filing-issues.md` for the format).

## 3. Install the app with a double click

1. Get the installer: `apps\desktop\release\bb-wn-Setup-<version>.exe`
   (NSIS; the exact name is
   set by the `apps/desktop` build, confirm the version first).
2. **Double-click it**. Do not run it from a terminal: this step validates the
   normal-user path.
3. Expected:
   - If SmartScreen says "Windows protected your PC" (unsigned build): that is
     expected for an internal build; `More info` → `Run anyway`. On a signed
     release it must NOT appear: if it does, that is a failure.
   - NSIS wizard in Spanish or English depending on the OS, default path under
     `%LOCALAPPDATA%` or `Program Files` (note which one), progress bar,
     `Finish`/`Close` button with no errors.
   - When done there is a "bb" entry in the Start menu.

## 4. First window: real Electron, NO browser

1. Open "bb" from the Start menu (or leave the launch-on-finish checkbox
   ticked at the end of the installer).
2. Expected, in this order:
   - A **native desktop window** with the "bb" icon and title. It has to be
     Electron; Edge/Chrome opening does not count.
   - The window does **NOT** ask you to open `http://localhost:38886` or any
     URL in the browser. Any "open in browser" is a direct failure of the port
     (that was the WSL behaviour, forbidden here).
   - The window answers the first click within ~5 s (note the actual time you
     see).
3. Screenshot: `qa-evidence\50-first-window.png` (manual name, see README).

## 5. Open the `C:\bb-test` project

1. From the app, open the `C:\bb-test` folder (File → Open / picker depending
   on the real UI; note the path you followed).
2. Expected:
   - The files (`nota.txt`, `datos.csv`, `diseño.txt`) listed with no
     mojibake: the `ñ` renders as `ñ`.
   - Opening `nota.txt` shows its contents. Edit and save works.
3. Optional (the port's hard paths): repeat with a copy at
   `C:\bb test\` (with a space) and, if you dare,
   `C:\proyectos\diseño\`. Note which one you tried.

## 6. PowerShell terminal inside the app

1. Open the app's integrated terminal on `C:\bb-test`.
2. Run:

```powershell
$PSVersionTable.PSVersion
[Console]::OutputEncoding
Get-Location
'chcp' 65001 | Out-Null; 'diseño: ñ á é'
```

3. Expected:
   - It is `powershell.exe` (not `cmd`, not bash): the prompt and
     `$PSVersionTable` confirm it.
   - `Get-Location` is `C:\bb-test` (the terminal starts in the project).
   - The line with eñes prints intact (UTF-8; `chcp 65001` is the port's
     documented path if the default codepage breaks accents).
   - A long command (`dir -Recurse`) can be interrupted with `Ctrl+C` and the
     terminal stays alive.

## 7. Close the app: nothing stays alive

1. Close the window (the X) and quit fully (tray → Quit if there is a resident
   icon; note whether there is one).
2. Wait 10 s and run:

```powershell
tasklist /FI "IMAGENAME eq bb wn.exe"
Get-Process -Name 'bb wn', bb, electron -ErrorAction SilentlyContinue
```

3. Expected: both queries **empty** (`INFO: No tasks are running` in
   `tasklist`, nothing in `Get-Process`). Any orphaned `bb wn.exe` is a
   failure (on Windows killing the parent does NOT kill
   the children; clean shutdown is a requirement of the port). The product
   process is `bb wn.exe` (Electron main, server bridge, host daemon and
   renderers all share this image name); there is no separate `bb.exe` or
   `electron.exe`.
4. Save the proof: `qa\scripts\collect-evidence.ps1` writes
   `90-tasklist.txt` + `91-processes.csv`. Also attach a screenshot of the
   `tasklist` if there were orphans.

## 8. Clean uninstall

1. Settings → Apps → "bb" → Uninstall (or the `Uninstall.exe` next to the
   installation, whichever exists; note which one you used).
2. Expected:
   - Uninstaller with no errors; when done there is NO "bb" entry in the
     Start menu or the app list.
   - Repeat the step 7 `tasklist`: empty.
   - The install folder is gone. Your user data may survive depending on the
     product (note what was left under `%USERPROFILE%\.bb` (product data:
     database, logs, runtime file), `%APPDATA%\bb` (Electron/Chromium
     profile) and `%LOCALAPPDATA%`; do not
     delete it by hand before noting it).
3. Evidence: `qa-evidence\92-tasklist-after-uninstall.txt` (copy of the
   post-uninstall `tasklist`) + screenshot of the Start menu without "bb".

## Closing the pass

Mark each step `PASS` / `FAIL` / `NA` (with a reason) on the PR. Any single
`FAIL` invalidates the pass verdict: there is no averaging. Always include:
`00-host.txt` (exact OS: `Caption`, `Version`, `OSArchitecture`), the `*.txt`
files for the steps you ran, the cited screenshots, and the step 7
`tasklist.txt`.

## Recorded pass — 2026-09-06, real Windows 11 Pro 10.0.26200 x64

Machine `SapphireOS`, installer `apps\desktop\release\bb-wn-Setup-0.42.1.exe`,
default path `%LOCALAPPDATA%\Programs\bb wn`. Evidence committed under
`qa-evidence/win11-live/` (first attempt) and `qa-evidence/win11-live2/`
(second attempt, supersedes where noted). Server `http://127.0.0.1:38886`,
local API needs no auth. Product data dir `%USERPROFILE%\.bb`, logs
`%USERPROFILE%\.bb\logs`.

- Step 3 (install): PASS for install mechanics — silent `/S` install exit 0,
  Start-menu `bb wn.lnk` present, install dir populated. NOT exercised:
  interactive double-click and the SmartScreen/Defender flow (no interactive
  user in this session); that gap stays open for a human pass.
- Step 4 (first window): PARTIAL — a native Electron window provably exists
  (process with nonzero MainWindowHandle, title `bb`, `--type=renderer` and
  `--type=gpu-process` children of the same `bb wn.exe` image; no Edge/Chrome
  window involved, never asked for a browser URL), but it could not be brought
  to the foreground from a non-interactive shell session
  (`SetForegroundWindow`/`SetWindowPos TOPMOST` ignored while another app owns
  the foreground), so no pixels were captured and first-click latency was not
  measured. No misleading screenshot is attached.
- Step 5 (open `C:\bb-test`): PASS at the daemon/API level — `files/list`,
  `files/paths` and `files/read` return 200 with `ñ` intact for `C:/bb-test`,
  `C:/bb test` (space) and `C:/proyectos/diseño` (non-ASCII), with both `/`
  and `\` separators (`41-host-commands.json`, backslash spot-check
  console log). The in-app File → Open picker clicks were not performed
  (headless session). Note: `win11-live/21-host-commands.json` from the first
  attempt is INVALID evidence — its script built paths with single-`\`
  JS string escapes (`"C:\bb-test"` → backspace + `bb-test`), so every
  `invalid_path / Path must be absolute` there is a script bug, not a product
  defect; it is superseded by `win11-live2/41-host-commands.json`.
- Step 6 (PowerShell terminal): PASS over the real daemon ConPTY path —
  `powershell.exe` confirmed, cwd `C:\bb-test`, `Write-Output 'diseño ✓'`
  round-trips intact, resize 200, `Get-ChildItem -Recurse` interrupted with
  Ctrl+C and shell stays alive (`ALIVE_AFTER_CTRLC`), close 200, and the
  ConPTY shell PID is reaped (no `powershell.exe` orphan parented to the
  daemon; `43-terminal-orphans.txt`). Staged transcript:
  `42-terminal-staged.txt`. (The first attempt's `23-terminal-output.txt`
  only kept the final 8000-byte tail, so its `diseño ✓` check was unobserved;
  re-run staged in `win11-live2`.)
- Step 7 (close, nothing stays alive): PASS — graceful `taskkill /PID` on the
  Electron main (WM_CLOSE, equivalent of window X) leaves zero `bb wn.exe`
  and port 38886 in TIME_WAIT only (`45-pre-close-*`, `46-post-close-*`).
  KNOWN-ISSUES K3 partiality does not bite on clean shutdown.
- Step 8 (uninstall): PASS — `Uninstall bb wn.exe /S` exit 0, install folder
  gone, Start-menu entry gone, `tasklist` empty (`47-*`). `%USERPROFILE%\.bb`
  (database, logs, thread storage) deliberately survives; after reinstall the
  same host identity (`host_w4znqq4hr5`) and threads reattach intact.
- Daemon kill-recovery (beyond the checklist, core of this pass): PASS —
  `taskkill /F` on the daemon process: server logs `Daemon WebSocket closed`,
  host reads 502 while down, ~6 s later a new session replaces the old one
  (`replacedSessionId`), new `Host daemon started` with a new instanceId,
  fresh worker children, and the old subtree fully reaped (no orphans).
  Post-recovery `files/*` calls return 200.
- Real agent turn (provider `acp-opencode`, thread `thr_jqysbdei7z`): PASS —
  read `nota.txt`, wrote `C:\bb-test\resultado-qa.txt` (`nota de prueba` +
  `VERIFICADO-WIN11`), verified on disk and via `turn/completed` +
  `fileChange completed` events (`44-agent-turn.txt`).
- Script fix in this pass: `qa\scripts\collect-evidence.ps1` watched
  `Get-Process -Name bb, node, electron` and therefore recorded ZERO `bb wn`
  rows while 19 `bb wn.exe` ran; now watches `'bb wn'` too. Checklist
  corrections: installer file name, `bb wn.exe` process names, product data
  dir `%USERPROFILE%\.bb`.
- Machine left WITH the app installed, running and connected (reinstalled
  after the uninstall step, host `connected`).
