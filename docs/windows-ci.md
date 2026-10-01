# Windows CI foundation

The `Windows host packages (Node 22.x)` job in
`.github/workflows/ci.yml` runs on Blacksmith Windows Server 2025 x64. It runs on
every pull request and main push, alongside the existing Linux checks. A failure
fails the job; the Windows tests are not advisory.

The job runs complete test suites and typechecks for nine packages:

- `@bb/process-utils`, `@bb/host-workspace`, and `@bb/host-watcher`
- `@bb/agent-runtime`, `@bb/provider-bridge-protocol`, and `@bb/provider-bridge-acp`
- `@bb/host-daemon-contract`, `@bb/config`, and `@bb/db`

Turbo runs with `--force`, so a cached result from another OS cannot stand in for
Windows execution, and `--concurrency=2` limits contention between process-heavy
suites. Packages use shared Vitest workers with isolation for tests that mutate
global state.

The native Windows coverage exercises:

- Native executable and PATH-resolved `.cmd` launches with spaces and Unicode in
  paths, literal arguments, stdin, stdout, stderr, and nonzero exit status.
- Missing executable errors and case-insensitive runtime environment cleanup.
- Buffered command output limits, cancellation, streaming stderr, and stdin EOF.
  Cancellation and timeout delegate owned-process termination to Execa on every OS.
- Drive-letter and UNC path containment, sibling-prefix escapes, and cross-drive
  or cross-share rejection.
- Real Git repositories: empty repositories, status, commits, diffs, branches,
  linked worktrees, squash detection, fetch authentication, and command timeouts.
- GitHub PR lookup and actions against local CLI fixtures, including Windows
  `.cmd` launchers, missing CLI, and authentication failures.
- Native Parcel filesystem events, ignored nested directories, watcher recovery,
  and Git metadata subscriptions.
- Real provider bridge subprocesses: thread/session lifecycle, cancellation,
  replacement, ACP model discovery, MCP tools, and recorded provider conformance.
- ACP launchers and model/version probes through the portable command runner;
  awaited agent termination before session teardown.
- Windows drive-root and case-insensitive ACP write-scope containment.
- Process identity verification through Windows CIM command-line and creation-time
  fields before stopping a recorded process.
- Native file-lock exclusion across processes and recovery after the owner dies.
- SQLite migrations, repositories, transactions, and schema/protocol validation.

Git pipelines use the shell reported by `git var GIT_SHELL_PATH` on Windows.
Use a recent Git for Windows that supports this query; WSL is not used by this check.

Install and run the same slice from the repository root in PowerShell:

```powershell
npm install --global pnpm@9.15.0 --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts --filter bb --filter "@bb/process-utils..." --filter "@bb/host-workspace..." --filter "@bb/host-watcher..." --filter "@bb/agent-runtime..." --filter "@bb/provider-bridge-protocol..." --filter "@bb/provider-bridge-acp..." --filter "@bb/host-daemon-contract..." --filter "@bb/config..." --filter "@bb/db..." --filter "bb-plugin-provider-acp..." --filter "bb-plugin-provider-codex..." --filter "bb-plugin-echo-provider..." --filter "@bb/app..."
pnpm exec turbo run lint typecheck test --filter=@bb/process-utils --filter=@bb/host-workspace --filter=@bb/host-watcher --filter=@bb/agent-runtime --filter=@bb/provider-bridge-protocol --filter=@bb/provider-bridge-acp --filter=@bb/host-daemon-contract --filter=@bb/config --filter=@bb/db --force --continue --concurrency=2 --output-logs=full
```

The filtered install includes root tooling, package dependencies, and the real
provider plugins used by runtime and recorded-conformance fixtures. App
dependencies supply the existing Plugin SDK runtime/theme generators; the job
does not build or test the app or Electron. The scripted echo provider is an
explicit runtime test dependency.

Install scripts are disabled because the root prepare step generates the entire
product. Turbo runs the required generators and native-module preparation.
SQLite and Parcel's Windows native addons are exercised by their suites.

## Process boundary

`@bb/process-utils` owns executable resolution, owned process lifetimes, and OS
process inspection. Long-lived children use `cross-spawn` for executable, PATH, PATHEXT, and `.cmd`
handling. Buffered commands use Execa 10 behind `execPortableFile`; BB does not
implement command resolution or shell quoting itself. Callers use these shared
interfaces rather than selecting a process library or OS-specific flags.

- `spawn.ts` contains the shared portable launch implementation.
- `managed-process.ts` pairs a piped child with an idempotent `stop()` promise.
  It creates the POSIX process group at launch, so callers do not choose
  `detached` or branch on the OS. `stop({ gracePeriodMs })` resolves after the
  retained root exits and reports `treeTermination: "confirmed" | "unverified"`.
  Confirmation covers the owned group or OS-tracked tree, not escaped processes.
  Failure to terminate the root rejects within the shutdown deadline. Repeated
  calls share the first stop operation and its grace period.
- `exec-portable-file.ts` delegates buffering, command launch, cancellation,
  timeout, stdin input, and best-effort descendant termination to Execa. The
  adapter preserves BB's exact output, byte-based limits, sanitized environment,
  streaming UTF-8 stderr, and existing command error fields. Early output closure
  stops the command, including Execa's output-limit closure; the adapter retains
  no output buffers or cancellation timers of its own.
- `process-group.ts` and `windows-process-tree.ts` contain termination mechanics.
  Managed POSIX stop gives the leader the requested grace period, then kills
  surviving group members; group disappearance is polled for up to one additional
  second. Windows cannot offer a signal grace period: it immediately forces the
  tree with `taskkill /T /F` while the leader is alive, allowing two seconds for
  taskkill and one second for root exit. Failed taskkill falls back to terminating
  the retained root and reports unverified tree cleanup. An already-exited root
  is also unverified; its potentially recycled PID is never targeted. Neither
  path claims to track descendants that deliberately leave its group/tree.
- `process-info.ts` reads command and start time together in one OS query.
  Config still decides whether that identity matches a recorded BB process.

ACP and agent-runtime consume managed handles, and report unverified cleanup in
process diagnostics. Git's buffered commands and background fetch use the Execa
adapter; the bounded record reader uses a managed child. Shutdown failure is
propagated without waiting indefinitely for a stream close event. Git-specific
shell and error policy stay in host-workspace. The binary blob reader still uses Node's
buffered binary API. Low-level spawn/group exports remain for existing callers
outside this slice; new owned processes should use the managed API. The migrated
runtime and ACP launch boundary have lint rules preventing direct process launches
or manual process-group setup.

This structure follows the shared-launch and owned-lifetime patterns in
[T3's ProcessRunner](https://github.com/pingdotgg/t3code/blob/5cc99e1c23980d7995a13c47f969b47cb68ed1be/apps/server/src/processRunner.ts#L250)
and [Orca's child-process module](https://github.com/stablyai/orca/blob/449b8ca17dd16ab0074b968cdffe24bcee807b26/src/shared/child-process/run-process.ts#L44).
No source was copied. T3's scoped resource ownership, Orca's bounded termination
and explicit cleanup outcomes, and VS Code's separate terminal lifecycle inform
the boundary. Their Effect integration, custom Windows shim parsing, and native
process-table addons are not needed for this slice.

[Execa's descendant termination](https://github.com/sindresorhus/execa/blob/v10.0.1/docs/termination.md#killing-descendant-processes)
uses the same process-group/taskkill mechanisms for buffered commands. Its
group-wide Unix termination differs from the leader-first ordering retained for
long-lived providers.
[VS Code's process helpers](https://github.com/microsoft/vscode/blob/c353edbfa07735949e432e49b491ddc6baad49cc/src/vs/base/node/processes.ts#L150)
also use taskkill; Windows terminal sequencing remains a subsequent slice.

The Windows packages use the ordinary Turbo test prerequisites. Shared Vitest
inputs include `vitest*.ts`, covering both the worker configuration and temporary
directory setup; there are no Windows-specific package task overrides.

## Remaining Windows work

This check establishes package-level Windows support, not a runnable Windows app.
Provider integration tests use controlled agent fixtures and recorded traffic;
real installed providers still need end-to-end verification.

Windows stop operations use forced tree termination while the leader is alive.
They do not provide POSIX signal delivery or graceful signal handlers. Descendant
discovery after the leader has already exited, working-directory process sweeps,
and synchronous process-group helpers remain follow-up work. Existing tests for
Unix signals, filenames, symlinks, and Linux inotify counters remain
platform-specific.

Server/daemon startup, interactive terminals and node-pty, service installation,
provider installation commands, and desktop packaging/updates remain subsequent
slices. Electron runtime and packaging behavior are unchanged.

Add packages to the install and Turbo filters as their real Windows tests pass.
Keep the Linux suite running to protect existing behavior. Windows Server CI must
eventually be supplemented with Windows 11 verification for installation,
interactive terminals, updates, and actual provider sessions.
