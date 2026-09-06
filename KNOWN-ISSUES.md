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

## K3 — A process's working directory is not cheap on Windows

`Win32_Process` exposes PID, PPID, ExecutablePath and CommandLine, but **not** the
working directory. Enumeration therefore combines three strategies: a tree walk
by PPID, matching on CommandLine/ExecutablePath, and an internal registry of the
PIDs we spawned ourselves.

It is **deliberately partial**, and the type says so (`approximateCwd: true` on
every win32 result). There are two real failure modes:

- **Over-match:** a process that merely mentions the directory in its command
  line can be counted as being inside it.
- **Under-match:** a process whose cwd is invisible and which we did not spawn
  does not appear at all.

**Workaround:** spawn through `spawnPortableProcess` with `cwd`, which registers
the PID automatically, or register it manually.

Further detail in `packages/process-utils/known-issues.md`: 8.3 short names do
not match their long form, symlinks and junctions are compared lexically (pass a
canonical path), and fast PID reuse can misattribute a subtree within the window
of a single sweep.

**Proposed improvement, not implemented:** Job Objects with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` kill children even when the parent dies
abruptly. It needs a native helper (`CreateJobObject` /
`AssignProcessToJobObject`), i.e. a new dependency, so it was left as an explicit
proposal rather than smuggled in.

## K4 — The CIM probe has no timeout

This matches the POSIX `lsof` path, which has none either. A hung
`powershell.exe` would hang the sweep.

**Workaround:** none automatic. If observed, add a timeout.

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

## K6 — The environment probe does load the PowerShell profile

The runtime environment probe deliberately does **not** pass `-NoProfile`, to
mirror the `-ilc` behaviour of the POSIX path; marker-delimited parsing ignores
profile noise. The interactive terminal does use `-NoProfile`, for determinism.

**Risk:** a user profile that writes aggressively to stdout could confuse the
parse. Not observed.

## K7 — Path edge cases left deliberately

- `isSameProjectPath` on `\\?\` paths with and without a trailing slash returns
  `false`. That is the honest consequence of **not re-normalising** `\\?\`
  prefixes, which is exactly what Windows expects of them. Making those equal is
  a decision that has to be taken explicitly.
- A bare `\\?\` returns `false`; it is an invalid degenerate form anyway.
- `\\.\` and `\\?\` are treated as equivalent for containment in the watcher,
  which is sufficient for its use.

## K8 — Symlinks and executable bits

Creating a symlink on Windows requires privilege or Developer Mode. The workspace
package **never creates one** (it detects them via `lstat` and skips them), so
there is no privilege dependency there. However:

- `chmod(file.mode)` on injected skills does **not** preserve the POSIX execute
  bit on win32. Executability of skill `.sh`/`.cmd` files on Windows is
  unresolved.
- Repositories that contain symlinks depend on git's `core.symlinks`: without
  Developer Mode they materialise as text files containing the target path.

## K9 — Development data directory

Only production is redirected to `%APPDATA%/bb`. In development
(`NODE_ENV != production`) the data directory still resolves under the home
directory via `@bb/config`.

## K10 — Auto-update is not wired

The `desktop-win-v*` tag namespace is deliberately separate from
`desktop-v*`/`desktop-latest`, which the upstream release flow treats as
immutable. It has not been confirmed that electron-builder emits `latest.yml` and
`.blockmap` with `--publish never` on Windows; if `latest.yml` were missing, the
release would ship without an update feed even though the `.exe` is present.

**Workaround:** after the first green release run, inspect the artifact listing
and tighten the globs.

## K11 — Editor coverage in "Open in…"

Only VS Code and VS Code Insiders have known Windows paths
(`LOCALAPPDATA`/`ProgramFiles`, and `Code.exe` directly rather than the wrapper).
Every other editor is found only if it is on `PATH` via `where.exe`. JetBrains
Toolbox is not mapped on Windows.

VS Code Remote is also advertised whenever the CLI is present even if `ssh` is
missing — that is **exact parity with macOS**, not an oversight.

## K12 — Folder picker fallback

The PowerShell fallback uses `FolderBrowserDialog`, which requires STA. The `-STA`
flag has not been exercised outside Linux. The primary path is Electron's native
dialog, which is genuinely native on Windows.

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
