# process-utils on Windows — known issues and workarounds

`listProcessesWithCwdUnder()` no longer returns `[]` on win32. Win32 exposes
no cheap working-directory handle per process (`Get-CimInstance Win32_Process`
yields `ProcessId`, `ParentProcessId`, `ExecutablePath` and `CommandLine`
only), so the Windows implementation is deliberately heuristic and says so in
its type: every Windows result carries `approximateCwd: true`, and `cwd` holds
the best evidence available (recorded spawn cwd, `ExecutablePath`, or the
matched `CommandLine` path), not an observed cwd.

## Partial enumeration strategy

A process matches a sweep directory when its executable path or one of the
absolute-path tokens in its command line falls under the directory, or when it
is a descendant (via `ParentProcessId`) of a match or of a pid this package
launched itself with a `cwd` under the directory (`spawnPortableProcess`
registers `{pid, cwd}` automatically; `registerSweepRootProcess` covers
processes spawned elsewhere — the host daemon wires its node-pty terminals
through it, retrying briefly while the ConPTY pid is still 0).

Every Windows result carries `matchEvidence` alongside `approximateCwd: true`:
`spawn-registry` (cwd recorded at spawn), `executable-path`, `command-line`,
or `descendant` (reached only through the PPID walk, which covers both
children of registered roots and children of guesses). The host daemon's reap
log prints `pid:evidence` so the guess quality travels with the action.

- Over-match: a process that merely references the directory (a `--log`
  argument, a script path) is swept even if its real cwd is elsewhere.
  Measured on Windows 11: a node child run from another directory whose argv
  trailed with the sweep directory was listed with that directory as its cwd
  (`command-line` evidence). Token matching is deliberately not tightened
  further — a standalone path argument is indistinguishable from a mention —
  and PPID propagation is kept for the kill path. Workaround: keep
  workspace-external logs and tool binaries outside swept directories; the
  sweep only needs pids, the caller decides.
- Under-match: a process whose cwd is under the directory but whose
  executable and command line reveal nothing about it is missed unless it
  descends from a tracked root. Measured on Windows 11: a raw-spawned
  powershell sleeper with cwd inside the sweep directory was invisible.
  Workaround: launch workspace processes through `spawnPortableProcess` with
  `cwd` set (auto-registered), or call `registerSweepRootProcess` right after
  spawning by other means and `unregisterSweepRootProcess` once reaped.
- 8.3 short paths (`C:\PROGRA~1\...`) are expanded best-effort before
  comparison via an injectable `canonicalizePath` hook (default
  `expandWindowsShortPath`, backed by `realpathSync.native` with an input
  fallback; only `~`-segment paths touch the filesystem, so injected-platform
  unit tests stay hermetic by passing the identity function). Measured on
  Windows 11: short against long matched neither way before, both ways after.
  Non-ASCII, spaces, forward slashes, UNC (`\\server\share`), `\\?\`-prefixed
  and drive-letter-case variants are normalised before comparison.
- Symlinked or junctioned workspace roots are compared lexically on Windows
  (no `realpath` check, so the injected-platform unit tests stay hermetic).
  Workaround: pass the canonical path to the sweep functions.
- Tracked pids are pruned against each successful CIM snapshot and
  unregistered on child `exit`, but a dead pid reused by the OS before the
  next sweep can misattribute a subtree. The window is one sweep interval
  and only affects pids this package itself launched.

## Killing

Each sweep target is killed with `taskkill.exe /PID <pid> /T /F`, which reaps
the whole tree. `taskkill` "process not found" for an already-exited pid is
tolerated; any other failure against a still-live pid aborts the sweep with an
error listing every outstanding pid (it never resolves to a partial list
silently). `killProcessGroup` uses synchronous `taskkill` and falls back to
`child.kill(signal)` when `taskkill` is unavailable; `stopProcessGroupLeaderFirst`
is best-effort by contract (always resolves) and taskkills the tree after the
leader timeout. Job Objects (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) would solve
orphans structurally but need a native module, which is out of scope; they
remain the recommended follow-up.

## Signals

`SIGTERM` and `SIGKILL` do not exist on Windows: Node maps both to
`TerminateProcess`, so there is no graceful-then-force escalation there and
`child.kill("SIGTERM")` kills the leader immediately. `process.kill(pid, 0)`
does work for liveness probes and is what the grace loops use. Negative-pid
(group) kills never run on win32 (`supportsProcessGroups()` is false there).

## Not proven on Linux

The Windows branches are pinned by unit tests with an injected platform and a
fake command runner (exact `powershell.exe`/`taskkill.exe` argv, realistic CIM
payload parsing, failure propagation). Real `taskkill` behaviour, the 20 live
kills and the 30-minute soak belong to the Windows runner and are still open.
