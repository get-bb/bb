<!-- Diátaxis: reference -->

# Platform Support

## Supported host environments

- macOS persistent host
- Linux persistent host
- Windows via Ubuntu on WSL2
- Native Windows host from a source checkout (PowerShell, CMD, `C:\` / UNC paths).
  Published npm and desktop download flows still document WSL2 as the Windows
  path until Windows CI is a required gate. See #1206.

Minimum runtime: Node.js 22.19. The floor comes from Pi, whose packages declare
`engines.node: ">=22.19.0"`.

Tested npm package runtimes:

- Node.js 22.19 or newer in the Node.js 22 release line
- Node.js 24 LTS
- Node.js 26 Current

Newer release lines are not blocked. `install-machine.sh` gates on the 22.19
floor only, so a release line we have not tested yet still installs rather than
failing hard on the day it ships. The `bb-app` npm `engines` field lists the
tested lines, which npm surfaces as a warning rather than an install failure.

Native Windows from this checkout:

- `npx bb-app`, the `bb` CLI (`apps/cli/bin/bb.cmd` in a source checkout), and
  a source-built Windows installer (`pnpm --filter @bb/desktop run dist:win`)
  run in PowerShell or CMD. `package:win` only emits the unpacked
  `win-unpacked/bb.exe` used for local smoke.
- Node.js, Git, and provider CLIs are native Windows installs (`.exe` / `PATHEXT`)
- local project paths accept drive-letter and UNC paths
- worktree setup hooks still use the POSIX `.bb-env-setup.sh` contract and run
  through Git's bundled `bash` when `sh` is not on `PATH`

Windows via WSL2 remains supported as the Linux stack inside Ubuntu:

- all `bb` processes run inside the same Ubuntu WSL2 distro
- Node.js, Git, provider CLIs, and pnpm for source-development flows are
  installed inside WSL2
- local project paths use Linux-style absolute paths from inside WSL2

Published desktop download assets remain macOS Apple Silicon. `dist:win`
writes an NSIS installer (`bb-<version>-x64.exe`). That file is not uploaded
to `desktop-latest` and has no Authenticode signature or `latest.yml` feed.

## Support Boundaries

### Supported product flows

- `npx bb-app`
- `npx --package bb-app bb ...`
- source checkout package startup with `pnpm start`
- source checkout validation with `pnpm install`, `pnpm build`,
  `pnpm exec turbo run typecheck`, and `pnpm exec turbo run test`
- app + server + host-daemon startup on supported persistent-host OSes
- local-path project creation and update in the app
- unmanaged environments
- managed worktree environments
- provider runtime startup where the provider itself supports the host
  environment
- `npx bb-app` package startup on supported npm package runtimes
- `npx --package bb-app bb ...` CLI execution through the published package

### Command ownership and mode selection

- `@bb/config` is the only source of dev/prod defaults.
- Repo-root source-development commands such as `pnpm start`, `pnpm bb`,
  `pnpm bb:dev`, and `pnpm reset` are thin wrappers around local packages and
  scripts.
- Those wrappers set `NODE_ENV` explicitly so ambient shell state does not
  change which bb instance they target.
- Explicit `BB_*` values override the `NODE_ENV`-selected defaults.
- Process-to-process handoff, such as daemon-injected CLI environment, must use
  explicit `BB_*` values for the exact target instance instead of relying on
  mode defaults.

### WSL2-specific expectations

- When you choose the WSL2 path, run `npx bb-app`, `pnpm install`, `pnpm dev`,
  `pnpm bb:dev`, and host-daemon commands from a WSL2 shell.
- Repositories inside the WSL filesystem are recommended for best behavior.
- `/mnt/c/...` mounted paths are deliberately supported so WSL2 users can keep
  working with existing Windows checkouts instead of relocating every repo into
  the WSL filesystem, but they are a tradeoff:
  slower filesystem I/O and weaker file-watching behavior than the WSL
  filesystem.

### Maintainer-only or best-effort surfaces

- workspace-owned QA helpers under [`tests/qa/`](../tests/qa/)
- dev restart internals that are not part of the shipped product path
- folder picker, `bb-dev-app`, and other host UX still marked best-effort on
  native Windows

## Dependency Policy

We are standardizing on a small set of cross-platform packages:

- `cross-env`
  - portable environment injection in package scripts
- `rimraf`
  - portable recursive cleanup in package scripts
- `cross-spawn`
  - shared subprocess launch for portability-sensitive runtime paths
- `open`
  - OS-specific file/URL opening behind a repo-local helper

We are explicitly not adopting:

- `shx`
  - we prefer small Node scripts for copy/create-directory logic
- generic path helper libraries
  - `node:path` is sufficient
- generic filesystem helper libraries
  - `fs/promises` is sufficient

### Native npm dependencies

The npm package keeps native add-ons as runtime dependencies instead of bundling
one platform-specific `.node` binary into bb's JavaScript artifacts. This lets
npm install the correct native artifacts on the target machine for packages such
as `better-sqlite3` and `@parcel/watcher`.

Known failure modes remain the normal native-addon ones:

- changing Node versions after install without reinstalling or rebuilding
- copying `node_modules` across operating systems, CPU architectures, or libc
  variants
- disabling package lifecycle scripts
- running on a platform where no prebuild exists and no local build toolchain is
  available

The recovery path after a Node/runtime change is to reinstall the package or
rebuild the native dependency, for example `npm rebuild better-sqlite3`.

## Setup Hook Policy

- The supported setup hook is POSIX `.bb-env-setup.sh`.
- The same shell-based hook contract is used across macOS, Linux, and WSL2.
- No parallel `.bb-env-setup.ts` product-path mechanism is supported.
- The `.worktreeinclude` copy step runs no shell. It works on every platform,
  including native Windows.

## Line Ending Policy

- The repository enforces LF checkout for supported text files via
  [.gitattributes](../.gitattributes).
- Supported Linux and WSL2 flows must work with those repository rules applied.
- Native Windows checkouts are a supported product path. Text files still
  check out as LF via [.gitattributes](../.gitattributes).

## CI And Validation

- GitHub Actions uses Ubuntu as the required support gate for build,
  typecheck, lint, test, and Linux smoke coverage.
- Full build, typecheck, lint, and test checks run on Ubuntu with Node.js 22
  only.
- Pull requests run the `bb-app` tarball smoke on Ubuntu and macOS with Node.js
  22, validating the packed npm artifact through `npx --package`.
- Pushes to `main` and manually dispatched CI runs also run the `bb-app` tarball
  smoke on Ubuntu and macOS with Node.js 24 and 26.
- Branch protection should require `Checks (ubuntu-latest, Node 22.x)`,
  `Package Smoke (ubuntu-latest, Node 22.x)`, and
  `Package Smoke (macos-latest, Node 22.x)`. The Node.js 24 and 26 compatibility
  smoke jobs do not run on pull requests and should not be configured as
  required PR checks.
- Native Windows CI is not required on pull requests. Ubuntu and macOS remain
  the required gates. Windows behavior is covered by in-repo unit tests that
  run on every host.
