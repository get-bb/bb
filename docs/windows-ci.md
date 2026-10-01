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
  Windows buffered commands terminate their process tree on cancellation or timeout.
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
pnpm exec turbo run typecheck test --filter=@bb/process-utils --filter=@bb/host-workspace --filter=@bb/host-watcher --filter=@bb/agent-runtime --filter=@bb/provider-bridge-protocol --filter=@bb/provider-bridge-acp --filter=@bb/host-daemon-contract --filter=@bb/config --filter=@bb/db --force --continue --concurrency=2 --output-logs=full
```

The filtered install includes root tooling, package dependencies, and the real
provider plugins used by runtime and recorded-conformance fixtures. App
dependencies supply the existing Plugin SDK runtime/theme generators; the job
does not build or test the app or Electron. The scripted echo provider is an
explicit runtime test dependency.

Install scripts are disabled because the root prepare step generates the entire
product. Turbo runs the required generators and native-module preparation.
SQLite and Parcel's Windows native addons are exercised by their suites.

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
slices. There are no Electron changes in this PR.

Add packages to the install and Turbo filters as their real Windows tests pass.
Keep the Linux suite running to protect existing behavior. Windows Server CI must
eventually be supplemented with Windows 11 verification for installation,
interactive terminals, updates, and actual provider sessions.
