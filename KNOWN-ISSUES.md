# bb wn — known issues

Collected from the reports of the agents that built this port, unsoftened. The
rule they worked under was: **never claim a Windows behaviour you did not
execute**. What follows respects that rule.

## The limitation that frames everything else

The port was written entirely on Linux. The only Windows machine available was
GitHub Actions `windows-latest` (**Windows Server 2025, build 10.0.26100** — the
same kernel as Windows 11 24H2). That gives real compilation, real tests and real
packaging, but **no interactive desktop**.

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

## K5 — ConPTY has never actually run

All terminal work is verified against a fake PTY adapter. It asserts what is
requested, not that it starts. **UTF-8 is the most exposed part**: if
`chcp 65001` is not enough, accented and box-drawing characters will come back
mangled, and nobody has seen it happen either way yet.

`.github/workflows/win-smoke.yml` exists precisely to close this: it starts a real
ConPTY, writes accented text, and asserts it survives the round trip.

**Status:** awaiting its first green run.

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

## K13 — What this setup can never prove

The runners are Windows Server with no interactive desktop. The following is out
of scope and **must be done by a person** on real Windows 11, following
`qa/CHECKLIST-WIN11.md`:

- double-clicking the installer, and the SmartScreen / Defender flow
- the Electron window opening without asking for a browser
- clean uninstall
- behaviour after a reboot
