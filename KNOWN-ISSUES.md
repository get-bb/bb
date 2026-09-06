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

## K14 — Enrolling a Windows machine as a bb host works, with measured limits

**History.** `apps/server/src/assets/install-machine.sh` (served at
`GET /install.sh`) used to admit macOS and Linux only, and persistence knew
only launchd plists and systemd user units. Driven on Windows 11 with Git for
Windows `sh.exe` it exited 1 with
`bb machine installation supports macOS and Linux only`. That guard is still
there for the `.sh` itself; Windows enrollment goes through a separate asset.

**What changed.** `apps/server/src/assets/install-machine.ps1`, served at
`GET /install.ps1` (also forwarded as a public path by the connect worker),
reaches the same end state as the `.sh`: per-server data dir under
`$HOME\.bb-machines\<server-host>`, server-matched `bb-app` tarball with
SHA-256 verification and `304` reuse, `npm.cmd` prefix install, machine-code
redeem, join, and a persistent launcher. The Add-machine dialog shows the
Windows PowerShell command next to the POSIX one-liner. Proven live on Windows
11 Pro build 26200, elevated and unelevated: download, npm install, join,
`connected`, `bb machine list`, and clean removal, all captured in the
closing report. Deepest installed path measured 180 characters against the
260 `MAX_PATH` limit with `LongPathsEnabled` 0.

**Persistence is a scheduled task, or a Run value.** A real Windows service was
rejected on measurement: `sc.exe create` fails `OpenSCManager FAILED 5`
without elevation, node has no service-main (a wrapper would be a new
dependency), and session 0 breaks user-profile assumptions. A scheduled task
(LogonTrigger, InteractiveToken, LeastPrivilege) is used when registration
succeeds; both `schtasks.exe` and the ScheduledTasks COM API return Access
Denied without elevation (measured with a stripped token), so an unelevated
installer falls back to an `HKCU\...\Run` value with a loud warning and
never requires an elevated prompt. Exactly one unit survives either path.

**Honest limits, all measured on this machine.** `RestartOnFailure` (PT1M x
9999) is registered but does not restart: three experiments (on-demand
`cmd /c exit 1`, on-demand external kill, time-trigger-fired `exit 1`)
showed no restart within 3-4 minutes, so the installer no longer promises
one — revive with `schtasks /Run /TN <task>` or rerun it. Logon start is
configured, not observed (no reboot was performed). The documented command
needs `-ExecutionPolicy Bypass` for that process (default Restricted policy).
No `chmod` hardening is faked on NTFS (see K2).

**Tests.** `apps/server/test/app/install-machine-ps1.test.ts` covers the `.ps1`
end to end against fixtures (usage, loud failures, digest/`304` handling,
port registry, machine-code redeem, task replace/run/delete and Run-key
replace, all with real scheduler/task/registry on Windows). The POSIX suite
(`install-machine-script.test.ts`) now also runs on Windows via `sh.exe`:
the skip narrowed to a shell-availability gate plus one case — the
per-server default data dir, where the emulation shell's translated `$HOME`
and Windows node disagree on what `$HOME` means. The `.sh` behavior for
macOS/Linux clients is byte-identical.

**Measured 2026-09-06 on this host: the scheduler refuses InteractiveToken
launches.** Registering the task and `schtasks /Run` both succeed, the
instance is queued and launched for the user, but the action never starts:
no task log, no listener, `LastResult` 2147946720 (Win32 4320, "the operator
or administrator has refused the request"), with no audit failure and no
system error. Even a trivial `cmd /c echo` probe task fails 4/4 while the
identical task with `S4U` succeeds and the Run-key path connects in seconds,
so the refusal is the `InteractiveToken` principal itself, not the installer
XML, the wrapper, or the port. An active console logon as the same user
exists and the Schedule service is healthy; no reboot is pending. Until the
host launches interactive tasks again, the scheduled-task persistence test
probes that exact capability first (register, run, and observe a marker file
from a trivial `InteractiveToken` task, gated on the measured refusal
`INTERACTIVE_TOKEN_LAUNCH_REFUSED_RESULT_MEASURED`) and skips when the host
refuses, while the forced Run-key test keeps asserting the fallback path a
normal user gets. The two persistence tests also claim an OS-assigned
loopback port and a random server name per run instead of sharing the fixed
38888 base and `winkeytest` name, after parallel suites on this shared host
were observed claiming the same 38888 port from separate fixture homes and
starving each other's daemons; cleanup now waits for killed daemons and
retries removal so `EBUSY` never fails teardown.

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

## K17 — @bb/agent-runtime on Windows: 139 failures were 4 causes — FIXED 2026-09-06

Measured on real Windows 11 Pro build 26200: `pnpm --filter @bb/agent-runtime
-exec vitest run` reported **139 failed / 179 passed (318)**. After the fix it is
**318 passed (22 files)**, stable across reruns, with `turbo typecheck
---filter=@bb/agent-runtime` green. No production file was touched; all four
causes lived in test invocation or test observability.

1. **128 of the 139 were a missing generated artifact, not a defect.** The
   suites spawn `dist/test-bridges/*.mjs`, built by
   `generate:test-bridges`, which only runs as a turbo `test` dependency.
   Invoking vitest directly without building first fails every test that
   launches a provider with `MODULE_NOT_FOUND`. Run the suite via turbo, or
   build the bridges first.
2. **1 failure was a hardcoded posix join in the test** (family B shape):
   `provider-registry.test.ts` expected `${bundleDir}/bb-...mjs` while
   production correctly uses `resolve()`. Fixed in the test.
3. **8 failures: child SIGTERM handlers never run on Windows.** Measured:
   `child.kill("SIGTERM")` returns true and the child dies with
   `signalCode SIGTERM`, but a `process.on("SIGTERM")` handler that writes a
   file never fires — it is TerminateProcess. Every fixture that self-reported
   shutdown from inside a SIGTERM handler was therefore silent: the scripted
   echo bridge's `exit:` log (4 process-lifecycle reap/retire tests), the fake
   codex app-server's `exit:` log (3 codex-topology tests), and the fake ACP
   agent's signal file (1 acp-topology test). Production reaps correctly via
   the taskkill process tree — every parent-side assertion already held. The
   tests now observe the same guarantee portably on Windows (startup-logged
   pid dead via `process.kill(pid, 0)`, `FAKE_ACP_LAUNCH_LOG` for the agent
   pid) and keep the self-report assertions on POSIX, behind
   `CHILD_SIGTERM_SELF_REPORT_UNAVAILABLE_ON_WINDOWS_MEASURED_KILL_IS_TERMINATE_PROCESS`.
4. **2 failures: non-detached grandchildren die with their parent.** Measured:
   a grandchild spawned without `detached: true` never runs its first line if
   the parent exits immediately, and never runs its timers even with a
   start-up handshake; with `detached: true` it survives and behaves as on
   POSIX. The stderr-drain test now spawns its inheriting writer detached, so
   the late write it models can occur on both platforms. The stale-output test
   asserts the stronger Windows guarantee instead: the SIGTERM-ignoring
   descendant is tree-reaped, so its marker never appears and no stale line
   reaches the replacement.

Not fixed because there is nothing to fix: `@bb/server` full-suite runs on
this machine vary run to run (3, 11, 15 failures across three identical runs,
all in `test/services/plugins/*` with timeout/esbuild shapes) while every one
of those files passes in isolation — parallel-load contention flakes,
untouched by and unrelated to this work.

## K18 — Packaged daemon bundle shipped an extensionless `bb` with no Windows launcher — FIXED 2026-09-06

Confirmed against a real built bundle on Windows 11 Pro (build 26200) before
fixing (`turbo run bundle --filter=@bb/host-daemon`, then direct probes):

- Raw `spawnSync(dist/bb, ["--version"])` → `ENOENT`. The artifact check would
still have passed (`bb` exists), then the spawn died — exactly as predicted.
- `node dist/bb --version` → `0.42.1`: the bundle was fine, only the launch
was broken. `dist/bb` is an extensionless `#!/usr/bin/env node` esbuild
bundle, `chmod 0755`.
- A probe `bb.cmd` (`@node "%~dp0bb" %*`) spawned raw → `EINVAL` (a `.cmd`
is not directly spawnable either — same defect class as K16); with
`shell: true` → `0.42.1`.

Fix, no new dependencies:

- `apps/host-daemon/scripts/build-bundles.mjs` now emits `dist/bb.cmd`
byte-identical to `apps/cli/bin/bb.cmd` (verified with `cmp`), next to the
existing `apps/cli/bin/title` → `dist/title` copy.
- `packages/bb-app/scripts/build-host.mjs` copies it into the enrolled-host
package; `packages/bb-app/package.json` `files` lists
`host-daemon/dist/bb.cmd`; `build.mjs` already copies the whole dist
directory, so the npm tarball carries it with no script change. The
generated host-package `package.json` lists whole directories and needed
no change.
- `packages/bb-app/src/launcher.ts` resolves the CLI name per platform at
all three call sites through `resolveBundledBbCliFileName` /
`resolveBundledBbCliPath`, which take platform as a required parameter and
never read `process.platform`. The boundary functions
(`requiredHostArtifactPaths`, `assertBbAppArtifacts`,
`assertBbHostArtifacts`, `createServerEnv`, `runBundledCliCommand`) accept
an optional `platform` defaulting to ambient at the edge, matching repo
idiom. On win32 the artifact check requires both `bb.cmd` and its `bb`
target; the POSIX required set is byte-identical to before. `BB_CLI`
advertises `...\bb.cmd` on win32 (thread-env `BB_CLI` already did via
`runtime-shell-env`).
- The spawn deliberately does **not** use `shell: true`: the first version
did, and it broke the `-e` CLI-override test on win32 (cmd.exe reparses
parentheses inside the eval string). `resolveBundledCliSpawnPlan` maps a
win32 `.cmd` target with an existing sibling to a direct
`process.execPath` spawn of the sibling extensionless file — the same shape
as `apps/cli/bin/bb` — so arbitrary user args never pass through cmd
quoting. Shells and `BB_CLI` consumers keep using `bb.cmd` (verified via
PowerShell `& '...\bb.cmd' --version` → `0.42.1`). A foreign `.cmd`
whose sibling is absent still spawns raw and fails loudly instead of
launching the wrong file.

Verified live after the fix, against the real `host-package` bundle output:
`runBundledCliCommand(["--version"])` → exit 0,
`assertBbHostArtifacts` PASS, `createServerEnv BB_CLI` →
`...\host-daemon\dist\bb.cmd`.

Tests pin, per platform explicitly: the file-name and path resolvers, the
spawn plan (including a missing forwarder target and case-variant names),
`BB_CLI` per platform, the required-artifact sets (POSIX ignores a stray
`bb.cmd`; win32 demands both files), plus a win32-gated live
forwarder run with argument forwarding and a POSIX-gated live raw run.
`bb-app` vitest went from 8 failed / 66 passed to 81 passed / 1 skipped /
0 failed on this machine. The 8 were pre-existing POSIX assumptions in the
same file, fixed alongside: three tests building expectations from posix
literals now use `join`/`resolve` like production, three `0o600` mode
assertions pin the measured NTFS `0o666` on win32 (K2 class), the npm `os`
allowlist now matches the shipped manifest (`darwin`, `linux`, `win32`),
and the chunk-dir regex accepts both separators. `@bb/cli` 538 passed /
0 failed, `@bb/desktop` 324 passed / 3 skipped / 0 failed, `@bb/server`
2228 passed / 26 skipped / 0 failed.

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

## K19 — `bb` is unusable from Windows PowerShell when the install path contains a space — MEASURED 2026-09-06, NOT FIXED HERE

Default install dir is `%LOCALAPPDATA%\Programs\bb wn` — note the space.
Measured on real Windows 11 Pro (build 26200), PowerShell 5.1, with the exact
environment a thread hands its agent (`BB_CLI=...\host-daemon\dist\bb.cmd`,
PATH headed by the daemon `dist` dir):

- `Get-Command bb` resolves to `.../dist/bb.cmd`, which looks healthy and masks
  the bug.
- Bare `bb status` fails: `'C:\Users\Administrator\AppData\Local\Programs\bb'
  is not recognized as an internal or external command` — the path was split
  at the space.
- `& "$env:BB_CLI" status` — the documented fallback in the agent instructions
  — fails identically.
- `node ".../dist/bb" status` works (exit 0): the bundle is fine.
- A space-free copy of the whole `dist` dir runs `bb.cmd status` fine.
- The same spaced `bb.cmd` invoked quoted from `cmd.exe` works fine.

So the split happens in the PowerShell-to-`.cmd` handoff, not inside `bb.cmd`
(`@node "%~dp0bb" %*`) and not in the bundle. This single defect fully explains
the flailing transcript that motivated the agent-experience task: the agent
could *find* `bb` (`Get-Command` works) but never *run* it, so it listed
Program Files, probed the asar-unpacked dir, hunted `node.exe` (named in
`bb.cmd`), and copied the CLI to a temp dir to dodge the space. Owned by the
concurrent "CLI paths with spaces" work; the repro above is the handoff. The
agent-instruction wording (`"$BB_CLI"`, fixed for PowerShell syntax in K22)
describes the intended post-fix behaviour.

## K20 — Non-ASCII bytes in an ACP agent's shell output arrive as U+FFFD — MEASURED 2026-09-06, environmental

Three real `acp-opencode` threads (plain `C:\bb-test`, spaced
`C:\bb-qa-space dir`, non-ASCII `C:\proyectos\diseño`) all completed read,
search, shell, create and report correctly — except one display corruption:
shell `aggregatedOutput` shows `dise�o.txt` and `Directory: C:\proyectos\dise�o`
(U+FFFD for ñ), while the `search`/`read`/`fileChange` items in the same turns
carry `diseño` correctly. Cause is below bb: PowerShell 5.1 emits the system
(OEM) code page and the agent process decodes those bytes as UTF-8. bb's own
file tools round-trip UTF-8 names exactly, so nothing is lost — only the
shell-output rendering of non-ASCII names is garbled, and only on Windows
(macOS/Linux are UTF-8 end to end). No bb-side knob can force an agent child's
console code page, so this stays a documented difference with the mitigation
"prefer bb file tools over shell listings for non-ASCII names".

## K21 — Leftover Bourne-isms outside the core agent path — MEASURED 2026-09-06, intentionally untouched

The core agent instructions, bb-cli skill and core guides now name both shell
forms (K22). Deliberately left alone:

- `bb-guide-plugins.md` account-pool lines (`printf '%s\n' "$VAR" | bb pool …`):
  one-time human auth flows, and `printf` exists on this machine only because
  Git-bash leaked onto PATH — absent on clean Windows. Needs a measured
  PowerShell stdin-piping equivalent before anyone writes one.
- `plugins/workflows` skill (`mkdir -p "$BB_THREAD_STORAGE/…"`, `jq`, `$run`):
  plugin-owned and deeply POSIX (`mkdir -p` and `jq` are not PowerShell 5.1);
  dual-forming the interpolation alone would still leave broken commands.
- The Claude Code probe failure on Windows reports the SDK-vendored text
  "spawning a musl-linked binary on a glibc Linux host … (/lib/ld-musl-*)"
  (only in `plugins/provider-claude-code/dist/host.js`, no bb source). It
  fires through the extensionless-shim launch failure, so it belongs to the
  concurrent provider-LAUNCH work, including whatever the real Windows cause
  turns out to be.

## K22 — Agent instructions told PowerShell agents to run Bourne syntax — FIXED 2026-09-06

Every provider turn appends `standardAgentAppendInstructions`, and CLI users
get the `bb-cli` skill plus `bb guide` chapters. Four Bourne-only forms were
measured broken under the real agent shell (Windows PowerShell 5.1, where the
agent natively runs): `"$BB_CLI"` as a command is a *parser error*
(`Unexpected token`), and `"$BB_THREAD_ID"` / `"$BB_ENVIRONMENT_ID"` /
`"$BB_THREAD_STORAGE"` expand to empty, so the copied command runs against no
target. Fixed by naming the PowerShell form alongside the Bourne form in the
standard append instructions, the bb-cli skill common checks, the providers
guide models query, the plugins guide storage/provider lines, and the
skill-creator evaluation spawn line. macOS/Linux forms are byte-identical to
before. Tests pin both forms through the same render path
(`packages/templates/test/templates.test.ts`,
`apps/server/test/skills/builtin-skills-shell-forms.test.ts`) and fail against
the pre-fix wording (negative control run 2026-09-06).
