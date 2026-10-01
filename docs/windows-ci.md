# Windows CI foundation

The `Windows host packages (Node 22.x)` job in
`.github/workflows/ci.yml` runs on Blacksmith Windows Server 2025 x64. It runs on
every pull request and main push, alongside the existing Linux checks. A failure
fails the job; the Windows tests are not advisory.

The job runs the complete test suites and typechecks for `@bb/process-utils`,
`@bb/host-workspace`, and `@bb/host-watcher` through Turbo with `--force`, so a
cached result from another OS cannot stand in for Windows execution. Packages use
shared Vitest workers with isolation for tests that mutate global state.

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

Git pipelines use the shell reported by `git var GIT_SHELL_PATH` on Windows.
Use a recent Git for Windows that supports this query; WSL is not used by this check.

Install and run the same slice from the repository root in PowerShell:

```powershell
npm install --global pnpm@9.15.0 --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts --filter bb --filter "@bb/process-utils..." --filter "@bb/host-workspace..." --filter "@bb/host-watcher..."
pnpm exec turbo run typecheck test --filter=@bb/process-utils --filter=@bb/host-workspace --filter=@bb/host-watcher --force --continue --output-logs=full
```

The filtered install includes root tooling and the packages' dependencies. Install
scripts are disabled because the root prepare step generates the entire product;
Turbo runs the generators needed by these packages. Their test tasks depend on
their source dependencies instead of the global SQLite/node-pty preparation task.
Parcel's Windows native addon is installed through its platform-specific optional
package and exercised by the watcher tests.

## Remaining Windows work

This check does not establish native Windows support for the app. The existing
POSIX process-tree tests remain POSIX-only: General Windows process-group helpers, leader-first shutdown, and process
enumeration by working directory are not covered or implemented by this slice.
The buffered Git/CLI command runner uses Windows tree termination, but this does
not establish provider-session or terminal lifecycle support. Existing tests that require Unix filenames,
Unix symlinks, or Linux inotify counters remain platform-specific. Provider
discovery, terminals, server/daemon startup, SQLite and node-pty, and desktop
installation/update verification are subsequent slices. There are no Electron
changes in this PR.

Add packages to the install and Turbo filters as their real Windows tests pass.
Keep the Linux suite running to protect existing behavior. Windows Server CI must
eventually be supplemented with Windows 11 desktop verification for installation,
interactive terminals, updates, and process lifecycle behavior.
