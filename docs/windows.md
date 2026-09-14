# Native Windows hosts

Fork-owned documentation for running bb on a native Windows host (no WSL2).
Upstream `docs/` describe the macOS/Linux/WSL2 contract; this page lists the
native Windows delta.

- Setup and operation of the Windows supervisor: [README.windows.md](../README.windows.md).
- Upstream platform contract: [docs/platform-support.md](platform-support.md).

## Platform support

Native Windows is a supported persistent host in this fork alongside macOS,
Linux, and WSL2. On native Windows:

- all `bb` processes run in native Windows PowerShell or CMD
- Node.js, Git, and provider CLIs are installed natively on Windows
- local project paths use native Windows drive-letter and UNC paths
- terminals run PowerShell (`pwsh`/`powershell.exe`) or `cmd.exe` through
  ConPTY

The WSL2 flow is unchanged: run everything inside one Ubuntu distro, use
Linux-style absolute paths, and keep native Windows paths out of that flow.

## Environment lifecycle hooks

The setup and teardown hooks are platform-specific:

| Platform           | Setup hook          | Teardown hook          |
| ------------------ | ------------------- | ---------------------- |
| macOS, Linux, WSL2 | `.bb-env-setup.sh`  | `.bb-env-teardown.sh`  |
| native Windows     | `.bb-env-setup.ps1` | `.bb-env-teardown.ps1` |

On native Windows bb runs a `.ps1` hook with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .bb-env-setup.ps1
```

A `.bb-env-setup.sh` file is ignored on native Windows and produces a
`setup-script-ignored` progress note; a `.ps1` hook is ignored on macOS, Linux,
and WSL2. Commit the hook that matches the host platform. The environment,
timeout, working directory, and failure contracts are otherwise the same as the
upstream [worktree hook contract](worktrees.md).

## Pi bridge command

The Pi provider starts `pi` from `BB_PI_BRIDGE_COMMAND` (default `pi`). On
native Windows a command that needs a shell — `pi`, `pi.cmd`, `pi.bat`, or an
extensionless path — is started through Node's `shell: true`, which joins the
command and its arguments into one `cmd.exe` string without quoting them.

- A `BB_PI_BRIDGE_COMMAND` whose path contains spaces fails: `cmd.exe` splits
  the path at the first space and reports that the truncated path cannot be
  found. Arguments that contain spaces (for example a session directory or an
  extension path) fail the same way because they share that string.
- Spawning a `.cmd` shim directly without `shell: true` is not a workaround on
  Node.js 22: it throws `EINVAL`.
- On macOS and Linux the bridge spawns the command directly and does not use
  the shell, so spaced paths work there.

Because a shell child cannot inherit the bridge's fd 3/4 pipes, the fork also
exposes the bridge channel over a named pipe
(`BB_PI_BRIDGE_CHANNEL_PIPE`). Keep the Pi install, the bb data directory, and
other bridge argument paths free of spaces on native Windows.

## Local project paths

Native Windows drive-letter and UNC paths are accepted at the app/server
boundary on native Windows hosts. In the WSL2 flow they are still rejected so
unsupported input fails clearly.

## Source development on native Windows

`pnpm dev` runs the whole stack natively: Vite serves the app with hot module
replacement, and the server and host daemon run from source through `tsx` under
their dev supervisors, so iterating needs no production build.

- Ports and the data directory are derived from the checkout path, so they are
  not fixed. `pnpm dev` prints the active app URL, server URL, host-daemon port,
  and data directory; read them from there instead of assuming values. Every
  checkout and git worktree gets its own set, so a dev instance never collides
  with a packaged or supervisor-managed bb on 38886/38887.
- App changes need no restart. Server and host-daemon changes do:
  `pnpm dev:restart-server`, `pnpm dev:restart-host-daemon`, and `pnpm dev:restart`
  rebuild, then restart only the affected service. `dev:restart-server` escalates
  to both services when the running host daemon reports a different
  `HOST_DAEMON_PROTOCOL_VERSION`, because a mismatched server/daemon pair cannot
  connect.
- Windows has no `SIGUSR1`, so a restart request travels through
  `<data dir>/dev-supervisors/<service>.restart`, which the dev supervisor polls;
  POSIX keeps the signal path. Supervisor pid files live in the same directory,
  and a pid file left behind by a forced stop is reported as stale and removed on
  the next restart request.
- `scripts/bb-dev-app` — and with it `pnpm dev:status` and `pnpm dev:stop` — needs
  the POSIX `screen` multiplexer and does not run on native Windows. Stop a dev
  stack launched from a terminal with Ctrl+C.
- Terminals, providers, plugin host workers, and the bundled `bb` CLI behave as
  they do on a supervisor-managed host; the fork only changes how the dev server
  and the dev host daemon start and restart.

The dev flow stays a maintainer surface rather than a shipped product path:
native Windows ships through the supervisor ([README.windows.md](../README.windows.md))
and the `npx bb-app` package, and the repository's remaining development commands
are POSIX-first.
