# Windows CI foundation

The `Windows host packages (Node 22.x)` job in
`.github/workflows/ci.yml` runs on Blacksmith Windows Server 2025 x64. It runs on
every pull request and main push, alongside the existing Linux checks. A failure
fails the job; the Windows tests are not advisory.

The job runs complete test suites and typechecks for nine packages:

- `@bb/process-utils`, `@bb/host-workspace`, and `@bb/host-watcher`
- `@bb/agent-runtime`, `@bb/provider-bridge-protocol`, and `@bb/provider-bridge-acp`
- `@bb/host-daemon-contract`, `@bb/config`, and `@bb/db`

Every other test suite runs in the `Windows tests` jobs described under
[Full test suite](#full-test-suite).

Turbo runs with `--force`, so a cached result from another OS cannot stand in for
Windows execution, and `--concurrency=2` limits contention between process-heavy
suites. Packages use shared Vitest workers with isolation for tests that mutate
global state.

The native Windows coverage exercises:

- Native executable and PATH-resolved `.cmd` launches with spaces and Unicode in
  paths, literal arguments, stdin, stdout, stderr, and nonzero exit status.
- Missing executable errors and case-insensitive runtime environment cleanup.
- Buffered command output limits, cancellation, streaming stderr, and stdin EOF.
  Cancellation and timeout use the shared owned-process termination boundary on every OS.
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
handling. Buffered commands use Execa 9 behind `execPortableFile`; BB does not
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
- `exec-portable-file.ts` delegates buffering, command launch, and stdin input to
  Execa. Cancellation, timeout, and output-limit closure use the same bounded
  ownership operation as managed processes. The
  adapter preserves BB's exact output, byte-based limits, sanitized environment,
  streaming UTF-8 stderr, and existing command error fields. Early output closure
  stops the command, including Execa's output-limit closure; the adapter retains
  no output buffers of its own.
  Windows missing-command classification uses `which-command` before launch,
  because Execa 9 does not retain cross-spawn's ENOENT verification.
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

Execa is pinned to 9.6.1, whose Windows launcher uses cross-spawn. Native CI
caught incompatible missing-command classification and batch argument handling
in Execa 10.0.1. BB therefore keeps owned shutdown in its shared module while
borrowing Execa's buffering and stream handling. Upgrade the library only after
these native launch and lifecycle regressions pass.
[VS Code's process helpers](https://github.com/microsoft/vscode/blob/c353edbfa07735949e432e49b491ddc6baad49cc/src/vs/base/node/processes.ts#L150)
also use taskkill; Windows terminal sequencing remains a subsequent slice.

The Windows packages use the ordinary Turbo test prerequisites. Shared Vitest
inputs include `vitest*.ts`, covering both the worker configuration and temporary
directory setup; there are no Windows-specific package task overrides.

## Full test suite

The `Windows tests (<shard>, Node 22.x)` jobs run the test suite of every
package outside the nine above, on the same runner image and on every pull
request and main push. A failure fails the job. The seven shards cover each
suite exactly once:

- `server-1` and `server-2`: `@bb/server`, split by file into two Vitest shards.
- `app-1` and `app-2`: `@bb/app`, split the same way.
- `plugins`: every `bb-plugin-*` package. This shard installs Bun, which the Pi
  plugin's runtime regression requires in CI.
- `packages-host`: host daemon, CLI, provider parity, and integration tests,
  one suite at a time.
- `packages-other`: every remaining package. Its negative filters exclude the
  groups above and the nine host packages, so a new package lands here
  without a workflow change.

The jobs install every workspace package with `--ignore-scripts`; Turbo runs the
generators and native-module preparation the suites depend on. They restore
and save Turbo outputs, capped at 256 MB per shard. The cache key includes the
runner OS, so a restored result was produced on Windows; a suite whose inputs
are unchanged is not run again. Without the cache every server and package
shard would rebuild the Plugin SDK's bundled types, which takes two to three
minutes on these runners against about thirteen seconds on a Linux
workstation.

The test step differs from the Linux one in three ways:

- It runs under `cmd`. A Git Bash step puts Git's MSYS tools first on PATH, and
  suites that run `tar` then get GNU tar, which reads `C:\...` as a remote host.
- `TEMP` and `TMP` point at the runner's temp directory. The runner's default
  is an 8.3 short path inside the user profile
  (`C:\Users\RUNNER~1\AppData\Local\Temp`). Suites outside the nine host
  packages compare temp paths against their long names, and the plugin install
  tests clone Git repositories into paths that pass 260 characters under it.
- `packages-host` runs one Turbo task at a time, and `plugins` and
  `packages-other` run two; the server and app shards each run a single suite.
  Suites that start many processes slow one another down sharply on a
  four-vCPU Windows runner. With two at a time, the `packages-host` suites
  failed 6 of 13 measured runs on five-second test timeouts and an integration
  test server that never finished closing. Each suite passes alone.

Run one shard locally from `cmd` or PowerShell after a full install:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm.cmd exec turbo run test --filter=@bb/server --continue --output-logs=new-only -- --shard=1/2
```

The example names `pnpm.cmd` because PowerShell's `pnpm.ps1` shim drops the
`--` separator, and Turbo then rejects `--shard`.

Each shard uploads `.turbo/runs/*.json` as a
`test-timings-windows-<shard>-<attempt>` artifact. With nothing restored from
the Turbo cache, shards finished in four to seven minutes; setup (checkout,
cache restore, install) is one and a half to two and a half minutes of that.

## App boot smoke

The `Windows app smoke (Node 22.x)` job builds `bb-app` from the checkout and
runs `packages/bb-app/scripts/smoke-boot.mjs` on the same runner image. The
smoke starts the built launcher on free ports with a temporary data directory,
waits for the server's `/health`, runs `bb status` through the bundled CLI,
waits for the expected built-in plugins to report `running`, checks that the
host daemon connected, then stops the process tree and confirms the server no
longer answers. It fails when a built-in plugin cannot load or the bundled CLI
cannot start. The same task runs on macOS and Linux:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec turbo run smoke:boot --filter=bb-app --output-logs=new-only
```

The same job then runs `packages/bb-app/scripts/smoke-tarball.mjs`, which packs
`bb-app`, runs it through `npx --package`, installs the tarball, runs each
installed command through the `.cmd` shim npm creates, and starts the full
stack and a joined daemon from the installed package:

```powershell
pnpm exec turbo run smoke:tarball --filter=bb-app --output-logs=new-only
```

The daemon bundle ships `bb.cmd` beside the extensionless `bb` script so
PowerShell and `cmd.exe` find `bb` on the PATH that bb gives agent shells. The
launcher and the CLI re-exec run the extensionless script through Node on
Windows, because Windows cannot execute a file by its shebang.

## Remaining Windows work

The package checks and the smokes establish that bb starts, installs from npm,
and packages on Windows. Native Windows is an alpha host (see
[platform-support.md](platform-support.md)). Provider integration tests use
controlled agent fixtures and recorded traffic; real installed providers are
verified by hand, not in CI.

Windows stop operations use forced tree termination while the leader is alive.
They do not provide POSIX signal delivery or graceful signal handlers. Descendant
discovery after the leader has already exited, working-directory process sweeps,
and synchronous process-group helpers remain follow-up work. Existing tests for
Unix signals, filenames, symlinks, and Linux inotify counters remain
platform-specific.

A Windows machine enrolled in another server runs its daemon from the user's
`Run` registry key, not a Windows service, so it stops when the user signs out.
No CI job covers that installer; it is verified by hand.

The full test suite runs on Windows, with gaps. Tests that only apply to POSIX
hosts skip themselves there. Lint and typecheck run on Windows only for the
nine host packages. The suites outside those packages are not yet verified
under an 8.3 short `TEMP` path or with paths longer than 260 characters; the
job avoids both rather than proving them. One product gap is known behind
that: the plugin server build skips its "import escapes the plugin directory"
check when the plugin directory is given as an 8.3 short path. The
integration test server's failure to finish closing beside another
process-heavy suite is unexplained; running `packages-host` one suite at a
time avoids it.

Keep the Linux suite running to protect existing behavior. Windows Server CI must
eventually be supplemented with Windows 11 verification for installation,
interactive terminals, updates, and actual provider sessions.
