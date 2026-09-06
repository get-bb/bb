# bb wn — known issues

Collected from the reports of the agents that built this port, unsoftened. The
rule they worked under was: **never claim a Windows behaviour you did not
execute**. What follows respects that rule.

## The limitation that framed everything else — now partly lifted

The port was written entirely on Linux. The only Windows machine available was
GitHub Actions `windows-latest` (**Windows Server 2025, build 10.0.26100** — the
same kernel as Windows 11 24H2). That gives real compilation, real tests and real
packaging, but **no interactive desktop**.

**Since 2026-09-06 this document also contains findings measured on a real
Windows 11 Pro desktop (build 26200).** Read the difference carefully, because it
was larger than expected:

- `@bb/desktop` had **9 failing tests on real Windows, not the 7 previously
  recorded**, and a baseline run on a pristine checkout confirmed all 9 predated
  any of this work. They are now **0**.
- `@bb/server` had **170** failing tests on real Windows.
- The ConPTY smoke went from 2/5 to **5/5** — see K5, where the harness, not the
  product, held both defects.

Treat "green on Windows Server CI" as necessary and not sufficient. Several of
the defects found here — a POSIX permission check on NTFS, `Start-Process`
resolution of an extensionless shim, `MAX_PATH` — only appear on a real desktop
with a real user profile.

This is why the design injects the platform as a parameter instead of reading
`process.platform`: it makes the Windows branch checkable from Linux. A test
asserting "`powershell.exe` was requested with these arguments" is a strong,
verifiable claim — but it is **not** the same as "PowerShell started and echoed".
Where that distinction matters, it is called out below.

---

## K1 — No code signing

The installer is unsigned (`sign: false`, no certificate available). Windows
SmartScreen will show "Windows protected your PC" on first run.

**Workaround:** More info → Run anyway. Real distribution needs an EV code
signing certificate.

## K2 — POSIX permissions protect nothing on Windows

`chmod 0600` on secrets, credentials, host id and descriptors is **best-effort**
on NTFS: Node only applies the read-only bit, the real control is ACLs, and Node
exposes no API for them.

The code deliberately does **not fake protection** — it never pretends the file
is hardened. On Windows those secrets are protected only by the permissions
inherited from the user profile.

**Practical consequence:** on a multi-user machine, another user with rights over
the profile could read them. **Workaround:** keep them under the profile's
`%APPDATA%` (which is what happens) and do not share the Windows account.

## K3 — A process's working directory is not cheap on Windows — MEASURED 2026-09-06

`Win32_Process` exposes PID, PPID, ExecutablePath and CommandLine, but **not** the
working directory. Enumeration therefore combines three strategies: a tree walk
by PPID, matching on CommandLine/ExecutablePath, and an internal registry of the
PIDs we spawned ourselves.

It is **deliberately partial**, and the type says so (`approximateCwd: true` on
every win32 result). There is no "running processes" list UI; the user-facing
surface is the sweep behind environment-destroy reaping
(`killProcessesWithCwdUnder` in the host daemon) and what it kills and logs.

Both failure modes were driven for real on Windows 11 Pro (build 26200) with a
fresh temp project directory as the sweep target (real CIM probe, ~1.4s):

- **Over-match, reproduced:** a node child whose real cwd was a *different* temp
directory but whose argv trailed with the project path was listed under the
project with that project path as its `cwd`, `approximateCwd: true`. A user
sees this pid reported as running in their project, and on environment destroy
it gets `taskkill /T /F` along with its whole subtree even though it never ran
there.
- **Under-match, reproduced:** a raw-spawned `powershell.exe Start-Sleep 30`
with cwd *inside* the project (spawned without the registry, so bb did not
track it) did not appear in the sweep at all. A user sees nothing, and on
environment destroy that process survives as an orphan.
- **Control:** the same workload spawned through `spawnPortableProcess` with
`cwd` inside the project was listed with its exact cwd.

**What changed 2026-09-06 (no new dependencies):**

- Every Windows result now carries `matchEvidence` — `spawn-registry`,
`executable-path`, `command-line` or `descendant` — and the
destroyed-environment reap log prints `pid:evidence` (`exact` on POSIX), so the
guess quality is visible where it is acted on instead of a bare flag.
- node-pty terminals now register their pid as sweep roots on open and
unregister on session end (with a short retry while the ConPTY pid is still 0),
so processes started inside a terminal stay reachable through the PPID walk
even after the terminal exits. Previously that registry cover existed only on
paper: nothing outside `spawnPortableProcess` ever called it.
- 8.3 short names now expand best-effort (`realpathSync.native` through an
injectable `canonicalizePath` hook, input fallback, filesystem touched only for
`~`-segment paths), so short executables match long sweeps in both directions.
Measured before: `C:\PROGRA~1` against `C:\Program Files` matched neither
way; after: matches. Non-tilde paths behave byte-identically to before.

**Deliberately not changed:** command-line token matching was not tightened — a
standalone path argument (`--workspace <dir>`) is textually indistinguishable
from a mere mention (`--log <dir>`), while attached `--flag=value` forms were
already ignored; PPID propagation was kept for the kill path, where missing a
child (orphan leak) is worse than sweeping a mentioner. Job Objects with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` still need a native helper
(`CreateJobObject` / `AssignProcessToJobObject`), i.e. a new dependency, so
that proposal stays open.

**Stays open:** over-match still kills mentioners on destroy (the log evidence
says why); under-match still misses processes bb never spawned that reveal
nothing; symlinks and junctions are still compared lexically (pass a canonical
path); fast PID reuse can still misattribute a registry subtree within one
sweep interval. Further detail in `packages/process-utils/known-issues.md`.

## K4 — The CIM probe now has a timeout — PARTLY CLOSED 2026-09-06

This matched the POSIX `lsof` path, which has none either. A hung
`powershell.exe` would hang the sweep.

Measured on real Windows 11 Pro (build 26200): the pinned
`Get-CimInstance Win32_Process` probe answers in ~1.2s steady state
(powershell.exe cold start included). `WINDOWS_PROCESS_ENUM_TIMEOUT_MS`
(10s, ~8x headroom, overridable per call via `processEnumTimeoutMs`)
now bounds both layers in `packages/process-utils`: the default runner
kills a hung child with SIGKILL (verified to reap a hung
powershell.exe in ~6ms on this machine) and rejects, and the
enumeration races any runner, injected or not, against the timeout. The
timeout degrades exactly like every other probe failure — `list`
rejects, `kill` propagates, and the runtime-manager reaper already
catches that and logs a warning — never an empty result, which would
fake a successful reap while processes survive. Live check: the real
default-runner probe still answers in ~1.4s. Tests cover a
never-settling probe for both `list` and `kill`, plus a
slow-but-inside probe that still enumerates.

Still open: the POSIX `lsof` path has the identical theoretical hang
(no timeout around `lsof`; it resolves partial results on error, which
is graceful but unbounded). It should get the same treatment, left
untouched here as outside the Windows task.

## K5 — ConPTY has now actually run — CLOSED

Superseded. ConPTY has been exercised on a real Windows 11 Pro (build 26200)
desktop: `apps/desktop/scripts/smoke-windows-conpty.mjs` is **5/5 green**,
including `spawn-echo`, `resize`, `utf8`, `close` and `tree`.

Two defects found were in the **harness**, not the product:

- The harness read `pty.pid` synchronously at spawn. `node-pty`
  `1.25.260303002`/`1.2.0-beta.15` still reports `0` at that moment
  (`WindowsTerminal` copies `agent.innerPid = 0` at construct; the real PID
  only lands once the ConPTY connect completes). Measured: `0` at t0,
  a real PID from t+500ms. The `close` and `tree` cases were therefore running
  `tasklist`/`taskkill` **against PID 0** and reading back
  `"System Idle Process","0"`. The harness now reads the PID lazily and
  **refuses loudly rather than probing PID 0**.
- The `utf8` case blamed `chcp 65001`, which was innocent — its own output
  showed `diseño` intact, and what was lost was a character on the **input**
  side. Writes now send explicit UTF-8 bytes, matching the daemon product path.

**Honest caveat:** `utf8` passed on this machine even before that change (three
pre-fix runs green), so the CI `utf8` failure was **not** reproduced here. The
change pins the write encoding and removes a misdiagnosis; it is not evidence
that the CI failure is fixed.

## K6 — The environment probe does load the PowerShell profile — HARDENED 2026-09-06

The runtime environment probe deliberately does **not** pass `-NoProfile`, to
mirror the `-ilc` behaviour of the POSIX path; marker-delimited parsing ignores
profile noise. The interactive terminal does use `-NoProfile`, for determinism.

Exercised on real Windows 11 Pro (build 26200) with a temporary hostile
profile, since removed (none existed before; absence confirmed after): plain
text, ANSI colour output and non-base64 `PATH=` lines were already ignored,
but a fake `__BB_SHELL_ENV_START__`/`__BB_SHELL_ENV_END__` pair around a
valid base64 `PATH=C:\evil` line made `resolveUserShellPath` return `C:\evil`
instead of the real 1372-char PATH — silently. The old first-marker parse was
genuinely breakable, not just theoretically.

`parseWindowsPathFromUserShellEnv` now anchors on the **last** start marker:
the profile always runs before the `-Command` payload on the same stdout pipe,
so the real marker is always the last one. Verified live with the hostile
profile installed (a full fake pair, then a fake start marker plus evil PATH
with no fake end): the probe returns the real PATH in both cases. Regression
tests feed both shapes through the real `resolveUserShellPath` and fail
against the old parse.

Still open: the POSIX `parsePathFromUserShellEnv` has the identical shape and
the identical theoretical hole (rc/profile output precedes the payload on the
same pipe) and should get the same one-line treatment; left untouched as
outside this Windows task.

## K7 — Path edge cases — trailing slash FIXED 2026-09-06, rest confirmed

Re-measured on real Windows 11 Pro (build 26200); the trailing-slash asymmetry
was reachable through a real path, so it was fixed rather than re-documented.

- **Trailing slash on `\\?\` paths: was `false`, now `true`.** Validation
accepts both `\\?\C:\work\bb` and `\\?\C:\work\bb\`, and the
server-contract project schema stores `normalizeProjectPathInput` output
verbatim — so one directory could be opened as two project identities by any
caller passing `\\?\` form (CLI, SDK, scripts resolving long paths; UI file
pickers return plain already-trimmed paths and never hit this). `normalize` now
trims trailing separators on extended-length non-roots (`\\?\C:\` folds to
`\\?\C:`, which still detects as root), both variants store the identical
string (verified through `createProjectRequestSchema`), and `isSame` is
symmetric. The remaining `\\?\`-vs-plain difference is intended and
untouched, and the watcher needed no change — it already trims, so
`isWatchPathWithinRoot` was symmetric for trailing slashes in both directions
before and after.
- **Bare `\\?\`, clarified:** `isAbsoluteProjectPath` returns `false` and
validation rejects it everywhere, so it can never become a stored project
path. (`isSame` of the bare form with itself is `true` — equal degenerate
strings — which is why this entry now names the functions instead of saying
"returns false".)
- **`\\.\` and `\\?\` watcher equivalence: still true**, confirmed in both
directions (`isWatchPathWithinRoot` with either prefix as root or candidate).

## K8 — Symlinks and executable bits — EXECUTABILITY RESOLVED 2026-09-06

Creating a symlink on Windows requires privilege or Developer Mode. The workspace
package **never creates one** (it detects them via `lstat` and skips them), so
there is no privilege dependency there. However:

- `chmod(file.mode)` on injected skills does **not** preserve the POSIX execute
  bit on win32. Measured on real Windows 11 Pro (build 26200): even a freshly
  `chmod`ded 0o755 source file reads back 666 on NTFS, every staged copy lands
  at 666, and `fs.access(X_OK)` passes for everything — the mode bit carries
  no information on Windows. File **bytes** are always preserved, so nothing is
  lost; only the launch method needs choosing.
- What "executable" now means on Windows (all measured on the same machine):
  `.cmd`/`.bat` through `cmd.exe /d /c` with the raw path as its own argv
  element (pre-quoting it, or adding `/s`, re-breaks it; arguments containing
  spaces still misparse — inherited cmd behaviour), `.ps1` through
  `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File` (robust including spaces everywhere), `.mjs`/`.cjs`/`.js` through the
  daemon node runtime (robust including spaces), `.sh` and extensionless
  shebang files through Git for Windows `sh.exe` (robust including spaces).
  Bare execution fails loudly per kind and never silently: `.sh` dies EFTYPE,
  `.cmd` dies EINVAL, extensionless dies ENOENT.
  `resolveSkillScriptInvocation` in `apps/host-daemon/src/skill-script-launch.ts`
  pins this matrix (POSIX passes through untouched; win32 maps by extension
  and throws a loud error naming the file and the remedy for `.sh` with no
  sh.exe, extensionless, or unknown kinds). Platform-explicit unit tests run on
  Linux CI; win32-gated tests really spawn each mapping and assert the script
  output. The skill-creator guide tells authors to ship Windows-runnable
  scripts (interpreter-explicit invocations, never bare execution).
- Repositories that contain symlinks depend on git's `core.symlinks`: without
  Developer Mode they materialise as text files containing the target path.

## K9 — Development data directory — CORRECTED 2026-09-06

The old text said only production is redirected to `%APPDATA%/bb`. Measured on
real Windows 11 Pro (build 26200), that description was wrong: **neither mode
uses `%APPDATA%\bb` in practice.**

- Production default (`@bb/config` `resolveProdDataDir`, desktop
`resolveDataDirFromEnv` with no `BB_DATA_DIR`): `C:\Users\Administrator\.bb`
(home, not `%APPDATA%`). The packaged app's real data dir on this machine is
`~\.bb` (`bb.db`, `auth.json`, `host-id` present).
- Development default (`resolveRuntimeDataDir` dev, no `BB_DATA_DIR`):
`~\.bb-dev\<repo-label>-<hash>` — `C:\Users\Administrator\.bb-dev\c-wt-picli-9ea25e156488`
for `C:\wt-picli` — with per-instance ports.
- The `%APPDATA%\bb` redirect exists only in the host daemon's
`resolveHostDaemonDataDirOverride`, and only when `BB_DATA_DIR` is unset **and**
`NODE_ENV=production`. The desktop launcher always passes `BB_DATA_DIR`
explicitly, so the override never fires for app-spawned daemons; it fires only
for a standalone prod daemon without `BB_DATA_DIR` (e.g. a manually installed
service) — a third location.
- `%APPDATA%\bb` *does* exist on disk here, but it is Electron `userData`
(`Cache`, `Preferences`, …), not bb data — a confusingly similar path to a
different thing.

**Plainly for Windows contributors:** dev and prod disagree
(`~\.bb-dev\<instance>` vs `~\.bb`), so data created in dev never appears in
the packaged app and vice versa; and neither is `%APPDATA%\bb` despite what
this entry used to say. Hunting a prod database on Windows? Look in
`%USERPROFILE%\.bb`, not `%APPDATA%\bb`.

## K10 — Windows updates now poll their own namespace; end-to-end install still unproven

The `desktop-win-v*` tag namespace is deliberately separate from
`desktop-v*`/`desktop-latest`, which the upstream release flow treats as
immutable (`build-desktop.yml` refuses to mutate an existing `desktop-v*`
tag, and a single job resets the moving `desktop-latest` so one platform
cannot delete another's binaries). What was previously unknown — whether
electron-builder emits `latest.yml` and `.blockmap` with `--publish never`
on Windows — has now been measured.

**Measured 2026-09-06 on real Windows 11 Pro (build 26200):** the `dist:win`
output in-tree (current config, version 0.42.1, `--publish never`) contains
`bb-wn-Setup-0.42.1.exe`, `bb-wn-Setup-0.42.1.exe.blockmap` **and `latest.yml`**.
`latest.yml` was verified against the artifact (version 0.42.1, size 159047332,
recomputed SHA-512 matches), so the feared feed-less release does not occur.
The update decision was exercised locally by serving `release/` over HTTP
through electron-updater's real `getChannelFilename`, `parseUpdateInfo` and
`resolveFiles`: with the real feed, current version 0.42.1 reads "up to date"
and current version 0.0.1 reads "update available". The release globs already
covered `*.yml`/`*.blockmap`; they are now tightened to keep the internal
`builder-debug.yml` out of the published assets (`win-release.yml`).
No rebuild was run for this entry: the in-tree artifacts were produced from
the current config and version, so a second build would have re-proven the
same thing at the cost of machine contention. No competing Electron build was
running when checked.

**Wiring fix 2026-09-06 on real Windows 11 Pro (build 26200), no rebuild:**
the packaged Windows app polled
`https://github.com/get-bb/bb/releases/download/desktop-latest/` and therefore
asked for `.../desktop-latest/latest.yml`, which was measured live to return
HTTP 404 (while `.../desktop-latest/latest-linux.yml` returns 302), so a
Windows install could never find an update. Windows assets live under
`desktop-win-v*` (verified: `desktop-win-v0.42.1` on the fork holds the `.exe`,
`.blockmap` and `latest.yml`). The fix keeps the namespaces split and moves
Windows into its own moving tag: the provider
(`desktop-update-provider.ts`), the auto-update service
(`desktop-auto-update.ts`, now per-platform via
`createDesktopAutoUpdateFeedConfig`) and the baked `app-update.yml`
(`run-electron-builder.mjs` for `--win` builds) resolve Windows stable to
`https://github.com/get-bb/bb/releases/download/desktop-win-latest/`
(`latest.yml`) and Windows nightly to `.../desktop-win-nightly/`
(`nightly.yml`); macOS and Linux resolve unchanged. `win-release.yml` now
resets `desktop-win-latest` to the same assets on every run, mirroring the
upstream moving-tag pattern without touching `desktop-v*`/`desktop-latest`.
Exercised without a build: the in-tree `release/` directory served over HTTP
through the real `getChannelFilename`/`parseUpdateInfo`/`resolveFiles`
resolves version 0.42.1 to "up to date" and 0.0.1 to "update available",
and the resolved `--win` publish config prints the `desktop-win-latest` base
(non-Windows prints `desktop-latest`, nightly `--win` prints
`desktop-win-nightly`). `@bb/desktop` vitest is 40 files / 322 passed /
3 skipped / 0 failed.

**Still open:** (1) the full `autoUpdater` download-and-install flow inside the
packaged app has not been exercised — that needs the Electron runtime plus a
hosted feed, and this entry proves only feed emission, feed integrity and the
version decision; (2) the `desktop-win-latest` moving release does not exist
on `get-bb/bb` yet — it appears the first time the updated `win-release.yml`
runs there, so live Windows installs still 404 until then; the nightly
`desktop-win-nightly` tag has no publisher at all (`win-release.yml` is
stable-only), so nightly Windows installs poll the right namespace but find
nothing by design.

## K11 — Editor coverage in "Open in…" (partly closed 2026-09-06)

Previously only VS Code and VS Code Insiders had known Windows paths
(`LOCALAPPDATA`/`ProgramFiles`, and `Code.exe` directly rather than the wrapper).
Every other editor was found only if it was on `PATH` via `where.exe`, and
JetBrains Toolbox was not mapped on Windows.

**Measured 2026-09-06 on real Windows 11 Pro (build 26200):** `where.exe` finds
no editor CLI on this machine, `%LOCALAPPDATA%\Programs\Microsoft VS Code`
is absent, `%LOCALAPPDATA%\JetBrains` does not exist at all, and the one
installed editor — Sublime Text at `C:\Program Files\Sublime Text\subl.exe`
— resolved to nothing (listing returned only Default App and File Manager).

**Since then:** `packages/local-open-targets` maps Windows install locations
for Cursor, Sublime Text, Zed, Windsurf and Antigravity under the existing
install roots, and JetBrains IDEs resolve two ways derived from the existing
`jetBrainsToolbox` adapter field — Toolbox script shims under
`%LOCALAPPDATA%\JetBrains\Toolbox\scripts` (probing `.cmd`/`.bat`/`.exe` so
no extension guess is baked in; scripts run through `cmd.exe`, which is what
makes `.cmd` shims spawnable) and versioned installs under
`<root>\JetBrains\<product>\bin\<tool>64.exe`. Verified live: Sublime Text
now lists and `subl.exe` was spawned for real (GUI process observed, then
closed). The rest were verified by unit tests with the platform passed
explicitly, plus negative tests (no Toolbox → no JetBrains targets); they were
**not** observed on a real install because none is present on this machine.
macOS and Linux resolution is untouched.

**Still open / intentionally unmapped:** BBEdit, TextMate, Xcode, Finder and
the macOS terminals have no Windows equivalent; Emacs has one but the adapter
defines no CLI open command, so it stays PATH-only like before. Cursor/Zed/
Windsurf/Antigravity paths are vendor defaults, not live-verified installs.
Six macOS-Terminal/iTerm2 unit tests fail when the suite runs on Windows
(POSIX `cd '…'` quoting around Windows tmp paths) — pre-existing on a pristine
checkout, unrelated to this change.

VS Code Remote is also advertised whenever the CLI is present even if `ssh` is
missing — that is **exact parity with macOS**, not an oversight.

## K12 — Folder picker fallback (exercised 2026-09-06)

The PowerShell fallback uses `FolderBrowserDialog`, which requires STA.
**Exercised 2026-09-06 on real Windows 11 Pro (build 26200):** the exact
fallback script was run for real. A visible `Browse For Folder` dialog appears
carrying the product description text, and confirming it returns the selected
path — `C:\Temp\bb picker space` (path with a space) and
`C:\Temp\ñandú-probe` (UTF-8 bytes `C3-B1`/`C3-BA` verified) both round-trip.
`powershell.exe` 5.1 already runs STA by default (apartment state reads STA
with and without the flag), so `-STA` is now passed explicitly to declare the
requirement at the call site rather than relying on the host default; the new
unit tests assert the flag and the null/trimming behavior with the platform
passed explicitly. Honest caveat: the confirm keystroke was synthetic
(`BM_CLICK` on the real OK button found via Win32 child enumeration, because a
background process cannot steal foreground input) — the dialog, the STA thread
and the returned paths are all real. The primary path remains Electron's
native dialog, which is genuinely native on Windows; in the host daemon on
Windows there is no Electron provider, so the PowerShell fallback — the path
exercised here — is the one that actually runs.

## K14 — Enrolling a Windows machine as a bb host does not work

`apps/server/src/assets/install-machine.sh` (served at `GET /install.sh`) is the
"add another machine as a host" installer. Its platform guard admits **macOS and
Linux only**, and persistence knows only launchd plists and systemd user units.
Driven on Windows 11 with Git for Windows `sh.exe` it exits 1 with
`bb machine installation supports macOS and Linux only`; git-bash's `sh` existing
does not help, because the installer refuses Windows by design.

**What a Windows user can do today:** run the server, app and CLI on Windows, and
join and control non-Windows hosts. **What they cannot do:** enrol *this* Windows
machine as a bb host. There is no Windows installer path.

`apps/server/test/app/install-machine-script.test.ts` is skipped on win32 through
`INSTALL_SCRIPT_POSIX_ONLY_MEASURED_UNSUPPORTED_ON_WINDOWS`, a named constant
rather than a bare platform guard, so the reason travels with the skip. The suite
still runs in full on macOS and Linux.

**Scope of the missing work, if it is ever scheduled:** a Windows installer asset
(or a Windows branch serving a `.ps1`), Windows service persistence,
`npm.cmd`/shell-aware spawning, and Windows-native fixtures — no shebang or
extensionless exec, no `PATH` wipe, no `nohup`/`mktemp`/`launchctl`/`systemctl`
assumptions.

## K15 — Local git plugin sources can exceed MAX_PATH

Installing a plugin or marketplace from a **local directory** builds a cache path
of the shape `…/plugins/cache/git/local/<the entire source path>/<sha>.staging`,
so the source path is embedded whole. On Windows that runs past the 260-character
`MAX_PATH` limit and git refuses with `Filename too long` on clone and on unlink.

Two separate defects were found here. The first is fixed: `parseGitSource`
decided a source was local with `urlish.startsWith("/")`, true only on posix, so
`C:\repo` became `https://C:\repo` and git answered *"URL rejected: Port number
was not a decimal number between 0 and 65535"*. Drive-letter and UNC paths are
now recognised. Removing that wrong error is what exposed the MAX_PATH one
underneath it.

**Status:** the MAX_PATH half is open. Installing a plugin from a **remote** git
URL is unaffected; only local-directory sources hit this.

## K16 — A provider CLI must be resolved with PATHEXT — FIXED

`where.exe` lists an npm extensionless `sh` shim first, and raw Node
`execFile`/`spawn` can execute neither that shim (`ENOENT`) nor a `.cmd`
directly (`EINVAL`). Codex and Claude Code happened to survive because their
version probes go through `runPortableCommandCapture` (cross-spawn, which does a
PATHEXT search and wraps in `cmd.exe`); **Pi probed with a raw
`execFile pi --version`** and so reported `currentVersion: null`. The app then
treated Pi as unusable and offered none of its models.

Binary lookup now prefers `.com/.exe/.bat/.cmd/.ps1` on win32, absolute
extensionless Windows paths resolve to their executable sibling, and the Pi probe
uses the shared portable command path. Measured after the fix: Pi
`0.85.1`, Codex `0.153.2`, Claude Code `2.1.263`.

The same defect class explains `spawn npm ENOENT` elsewhere — on Windows npm is
`npm.cmd` — so check for it before assuming a new cause.

## K13 — What this setup can never prove

The runners are Windows Server with no interactive desktop. The following is out
of scope and **must be done by a person** on real Windows 11, following
`qa/CHECKLIST-WIN11.md`:

- double-clicking the installer, and the SmartScreen / Defender flow
- the Electron window opening without asking for a browser
- clean uninstall
- behaviour after a reboot

## K17 — Host-layer Windows execution realities — MEASURED 2026-09-06

Facts established while bringing `@bb/host-workspace`, `@bb/host-watcher`
and `@bb/host-daemon-contract` to zero failures on Windows 11 Pro build
26200. All are encoded in tests; this entry records what authors of
lifecycle scripts and future Windows ports must know:

- `git`/`gh` are spawned through cross-spawn now (`portable-command.ts` in
  `@bb/host-workspace`), because raw Node `spawn`/`execFile` never apply
  PATHEXT: a `git.cmd` or extensionless shim first on PATH failed with
  `ENOENT`. The runner mirrors the `execFile` contract, including the
  sharp edge that an overflowing stream is truncated to `maxBufferBytes`
  rather than dropped. Real Git for Windows installs `git.exe`, so this
  only ever bit test fakes and shims.
- `powershell.exe` cold start takes about 2.6 s to first script output, so
  lifecycle-script timeouts in the low milliseconds cannot observe script
  output on Windows; the tests carry Windows patience for that reason.
- `taskkill /PID /T /F` runs no user-mode cleanup: a `try/finally` marker
  never lands in a force-killed `powershell.exe` (measured), so there is
  no Windows equivalent of the POSIX `TERM`-trap graceful stop. Abort
  still cancels provisioning; only the trap half is POSIX-only.
- Windows PowerShell 5.1 `Out-File` has no `utf8NoBOM` encoding, writes a
  BOM with plain `utf8`, and non-terminating errors still exit 0.
  Lifecycle scripts that must fail the provision need an explicit
  `exit N`; markers that are read back byte-exact should use
  `[System.IO.File]::WriteAllText`.
- Win32 filenames cannot end in a tab (creation throws `ENOENT`, measured)
  or the numstat tab-terminator ambiguity could never be round-tripped;
  the parser half of that test runs everywhere.
- `git worktree list --porcelain` prints forward slashes while
  `fs.realpath` returns backslashes, and a machine-global
  `core.autocrlf=true` rewrites worktree checkouts to CRLF. Both are
  environment output, not product defects; the tests normalize.
- Two fetch-race tests (`recovers from known concurrent remote-ref
  update failures`, `waits for a live remote-ref lock`) stay skipped on
  win32 with the pre-existing `runIf` guards: their fake-`git` sh wrappers
  need the same node-fake treatment the `gh` fakes got, which is real but
  unstarted work.
