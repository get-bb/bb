# Windows CI

Every Windows job in `.github/workflows/ci.yml` runs on Blacksmith Windows
Server 2025 x64 alongside the Linux checks. Main pushes run all of them; pull
requests run the jobs that [PR selection](ci-performance.md#pr-selection)
picks, and frontend-only pull requests leave their Windows coverage to main. A
selected Windows job is blocking, not advisory.

## Host packages

The `Windows host packages (Node 22.x)` job runs lint, typecheck, and the full
test suite for nine packages:

- `@bb/process-utils`, `@bb/host-workspace`, and `@bb/host-watcher`
- `@bb/agent-runtime`, `@bb/provider-bridge-protocol`, and `@bb/provider-bridge-acp`
- `@bb/host-daemon-contract`, `@bb/config`, and `@bb/db`

Turbo reuses results from Windows-only cache keys; Linux and macOS entries
cannot satisfy these checks. `--concurrency=2` limits contention between
process-heavy suites.

Reproduce from the repository root in PowerShell:

```powershell
npm install --global pnpm@9.15.0 --ignore-scripts
pnpm install --frozen-lockfile --ignore-scripts --filter bb --filter "@bb/process-utils..." --filter "@bb/host-workspace..." --filter "@bb/host-watcher..." --filter "@bb/agent-runtime..." --filter "@bb/provider-bridge-protocol..." --filter "@bb/provider-bridge-acp..." --filter "@bb/host-daemon-contract..." --filter "@bb/config..." --filter "@bb/db..." --filter "bb-plugin-provider-acp..." --filter "bb-plugin-provider-codex..." --filter "bb-plugin-echo-provider..." --filter "@bb/app..."
pnpm exec turbo run lint typecheck test --filter=@bb/process-utils --filter=@bb/host-workspace --filter=@bb/host-watcher --filter=@bb/agent-runtime --filter=@bb/provider-bridge-protocol --filter=@bb/provider-bridge-acp --filter=@bb/host-daemon-contract --filter=@bb/config --filter=@bb/db --continue --concurrency=2 --output-logs=new-only --summarize
```

The filtered install adds the provider plugins used by runtime and
recorded-conformance fixtures, and the app dependencies that supply the Plugin
SDK generators; the job does not build or test the app or Electron. Install
scripts are disabled because the root prepare step generates the entire
product; Turbo runs the required generators and native-module preparation.

## Full test suite

The `Windows tests (<shard>, Node 22.x)` jobs run the test suite of every
package outside the nine above, on the same runner image. A failure fails the
job. The thirteen shards cover each
suite exactly once:

- `server-1` to `server-3`: `@bb/server`, split by file into three Vitest
  shards.
- `app-1` to `app-4`: `@bb/app`, split the same way into four.
- `plugins-1`: the provider plugins (`bb-plugin-provider-*`) and the three
  other slowest plugin suites: Tasks, Connect, and the thread list. This shard
  installs Bun, which the Pi plugin's runtime regression requires in CI.
- `plugins-2`: every other `bb-plugin-*` package. Its negative filters exclude
  `plugins-1`, so a new plugin lands here without a workflow change.
- `packages-host`: host daemon and CLI, one suite at a time.
- `integration`: the integration tests, alone.
- `packages-build`: templates, bb-app, demo server, desktop, and plugin build,
  the same group as the Linux `packages-build` shard.
- `packages-other`: every remaining package, including provider parity. Its
  negative filters exclude the groups above and the nine host packages, so a
  new package lands here without a workflow change.

The shards are sized so that each finishes with the slowest Linux job instead
of after it; see [ci-performance.md](ci-performance.md#windows-test-shards).

The jobs install every workspace package with `--ignore-scripts`; Turbo runs the
generators and native-module preparation the suites depend on. They restore
and save Turbo outputs. The cache key includes the runner OS, so a restored
result was produced on Windows; a suite whose inputs are unchanged is not run
again. Before saving, the job removes every cache entry that its own Turbo run
summary does not name, so a shard keeps only what it can reuse.

The test step differs from the Linux one in three ways:

- It runs under `cmd`. A Git Bash step puts Git's MSYS tools first on PATH, and
  suites that run `tar` then get GNU tar, which reads `C:\...` as a remote host.
- `TEMP` and `TMP` point at the runner's temp directory. The runner's default
  is an 8.3 short path inside the user profile
  (`C:\Users\RUNNER~1\AppData\Local\Temp`). Suites outside the nine host
  packages compare temp paths against their long names, and the plugin install
  tests clone Git repositories into paths that pass 260 characters under it.
- `packages-host` and `integration` run one Turbo task at a time, and the
  plugin and other package shards run two; the server and app shards each run
  a single suite. Suites that start many processes slow one another down
  sharply on a four-vCPU Windows runner. With two at a time, the host daemon,
  CLI, provider parity, and integration suites failed 6 of 13 measured runs on
  five-second test timeouts and an integration test server that never finished
  closing. In later runs beside other suites only the host daemon and
  integration suites failed, so those two never share a runner with a suite
  that runs at the same time. Provider parity passed all 35 such runs and now
  runs in `packages-other`.

Run one shard locally from `cmd` or PowerShell after a full install:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm.cmd exec turbo run test --filter=@bb/server --continue --output-logs=new-only -- --shard=1/3
```

Use `pnpm.cmd`: PowerShell's `pnpm.ps1` shim drops the `--` separator, and
Turbo then rejects `--shard`.

Each shard uploads `.turbo/runs/*.json` as a
`test-timings-windows-<shard>-<attempt>` artifact. With nothing restored from
the Turbo cache, a shard finishes in about three to four minutes. Setup
(checkout, cache restore, install) is one and a half to two minutes of that,
against under one minute on Linux: unpacking the pnpm store and linking
`node_modules` are slow on NTFS, and the runners have no antivirus scanner to
turn off.

## Windows runner rules

- Git pipelines use the shell reported by `git var GIT_SHELL_PATH`; use a Git
  for Windows recent enough to answer that query. WSL is not used.
- Run test steps under `cmd`, not Git Bash. Git Bash puts MSYS tools first on
  PATH, and GNU `tar` reads `C:\...` as a remote host.
- Point `TEMP` and `TMP` at the runner's temp directory. The default is an 8.3
  short path, which breaks suites that compare temp paths against long names
  and pushes plugin-install Git clones past 260 characters.
- Keep process-heavy suites from running side by side: `packages-host` runs one
  Turbo task at a time, `plugins` and `packages-other` run two, and the server
  and app shards run a single suite. Each suite passes alone but times out
  beside another on a four-vCPU runner.

## App boot smoke

The `Windows app smoke (Node 22.x)` job builds `bb-app` from the checkout and
runs `packages/bb-app/scripts/smoke-boot.mjs`: it starts the built launcher on
free ports with a temporary data directory, waits for `/health`, runs
`bb status` through the bundled CLI, waits for the built-in plugins to report
`running` and the host daemon to connect, then stops the process tree. It then
runs `packages/bb-app/scripts/smoke-tarball.mjs`, which packs `bb-app`, runs it
through `npx --package`, installs the tarball, runs each installed command
through npm's `.cmd` shim, and starts the full stack and a joined daemon. The
same tasks run on macOS and Linux:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec turbo run smoke:boot --filter=bb-app --output-logs=new-only
pnpm exec turbo run smoke:tarball --filter=bb-app --output-logs=new-only
```

The `Windows desktop smoke (Node 22.x)` job packages the desktop app from the
same checkout and runs the packaged-app smoke against the result:

```powershell
pnpm exec turbo run package:win --filter=@bb/desktop --output-logs=new-only
pnpm exec turbo run smoke:packaged --filter=@bb/desktop --force --output-logs=new-only
```

It is a separate job because both smokes build `bb-app` and then spend about a
minute each on work that cannot overlap: the tarball smoke prunes and packs
`packages/bb-app/dist` while packaging copies it. In one job they ran back to
back and that job finished last in the workflow.

The daemon bundle ships `bb.cmd` beside the extensionless `bb` script so
PowerShell and `cmd.exe` find `bb` on agent shells' PATH; the launcher and CLI
re-exec run the extensionless script through Node because Windows cannot
execute a file by its shebang.

## Known gaps

Native Windows is an alpha host (see [platform-support.md](platform-support.md)).

- Provider integration tests use controlled agent fixtures and recorded
  traffic; real installed providers are verified by hand.
- Windows stop operations force-terminate the process tree
  (`taskkill /T /F`) while the leader is alive; there is no POSIX signal
  delivery or graceful shutdown. Descendant discovery after the leader exits,
  working-directory process sweeps, and synchronous process-group helpers are
  not implemented.
- A Windows machine enrolled in another server runs its daemon from the user's
  `Run` registry key, so it stops when the user signs out. No CI job covers
  that installer.
- Lint and typecheck run on Windows only for the nine host packages. POSIX-only
  tests skip themselves. Suites outside the host packages are not verified
  under an 8.3 short `TEMP` path or paths longer than 260 characters; the
  plugin server build skips its "import escapes the plugin directory" check
  when the plugin directory is given as an 8.3 short path.
- The integration test server sometimes fails to finish closing beside another
  process-heavy suite; the cause is unexplained.
- Windows 11 installation, interactive terminals, updates, and real provider
  sessions still need verification beyond Windows Server CI.
