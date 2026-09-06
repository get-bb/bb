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

1. Get the installer: `release\bb-<version>-x64.exe` (NSIS; the exact name is
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
tasklist /FI "IMAGENAME eq bb.exe"
tasklist /FI "IMAGENAME eq electron.exe"
Get-Process -Name bb, electron -ErrorAction SilentlyContinue
```

3. Expected: all three queries **empty** (`INFO: No tasks are running` in
   `tasklist`, nothing in `Get-Process`). Any orphaned `bb.exe` or
   `electron.exe` is a failure (on Windows killing the parent does NOT kill
   the children; clean shutdown is a requirement of the port).
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
     product (note what was left under `%APPDATA%` / `%LOCALAPPDATA%`; do not
     delete it by hand before noting it).
3. Evidence: `qa-evidence\92-tasklist-after-uninstall.txt` (copy of the
   post-uninstall `tasklist`) + screenshot of the Start menu without "bb".

## Closing the pass

Mark each step `PASS` / `FAIL` / `NA` (with a reason) on the PR. Any single
`FAIL` invalidates the pass verdict: there is no averaging. Always include:
`00-host.txt` (exact OS: `Caption`, `Version`, `OSArchitecture`), the `*.txt`
files for the steps you ran, the cited screenshots, and the step 7
`tasklist.txt`.
