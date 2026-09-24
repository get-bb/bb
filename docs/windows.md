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

## Fork app behavior

Two fork-owned deltas change app behavior on every platform:

- An unset `sidebar.organizationMode` preference defaults to By project
  (`project`); upstream defaults it to Custom (`chronological`). The preference
  stays server-backed, so an explicit choice, `bb settings ui set`, and
  `bb settings ui reset` behave as documented.
- The app remembers the last opened thread in browser storage
  (`bb.fork.lastThread`) and reopens it when a load lands on the new-thread
  screen (`/`). It validates the remembered thread against the cached sidebar
  bootstrap first, and never redirects after an in-session navigation. This
  keeps the active chat across dev-instance reloads, which upstream loses
  because it keeps the route only in the URL and in-memory history.

## Terminal shells

On native Windows the fork starts terminals in a shell the machine actually has,
and lets you choose among them:

- Detection order is PowerShell 7 (`pwsh.exe`, from `PATH` then
  `%ProgramFiles%\PowerShell\7` and the `WindowsApps` alias), Windows
  PowerShell, then Git Bash (`<Git install>\bin\bash.exe`, found beside a
  `git.exe` on `PATH` or under the standard Git for Windows locations). The
  first detected shell is the machine default; a machine with none fails the
  launch with one clear message.
- The Start terminal row in the side panel carries a **Shell** picker once the
  machine reports more than one shell, and the last choice is remembered as the
  `terminal.shellId` UI preference. A stored id that the current machine no
  longer offers falls back to that machine's default instead of failing.
- Git Bash starts as its own launcher does (`bash.exe --login -i`); PowerShell
  keeps `-NoLogo` and `-NoLogo -Command`. A command terminal on Git Bash uses the
  generic posix `-lc` arguments.
- `bb terminal shells --machine <id-or-name>` prints the ids, labels, paths, and
  the default; `bb terminal create --shell <id>` picks one. `terminal restart`
  still replaces a terminal with the machine default shell.
- Non-Windows hosts report no shell list, so the picker stays hidden and the
  existing posix resolution (`SHELL`, `/bin/zsh`, `/bin/bash`, `/bin/sh`) is
  unchanged.

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
- Windows has no `SIGUSR1` and cannot deliver `SIGTERM` to another process, so
  restart and stop requests travel through `<data dir>/dev-supervisors/<service>.restart`
  and `<service>.stop`, which the dev supervisor polls; POSIX keeps the signal
  paths. Supervisor pid files live in the same directory, and a pid file left
  behind by a forced stop is reported as stale and removed on the next request.
- `pnpm dev:status` prints the instance data directory, URLs, supervisor pids, and
  whether the app, server, and host-daemon ports are listening. `pnpm dev:stop`
  stops both dev supervisors through their stop files and then removes the
  remaining `pnpm dev` process tree, so ports and pid files are released.
  Upstream removed `scripts/bb-dev-app` and `pnpm dev:desktop` (#3669); the
  launcher now routes `dev:status`/`dev:stop` to the native dev instance control
  on every platform. Ctrl+C in the `pnpm dev` terminal keeps working.
- Terminals, providers, plugin host workers, and the bundled `bb` CLI behave as
  they do on a supervisor-managed host; the fork only changes how the dev server
  and the dev host daemon start and restart.
- The dev server hot-reloads builtin plugin sources. While a plugin is showing an
  open user form (an `AskUserQuestion` card, a secret request), its rebuild and
  reload are held back and retried every few seconds so the form survives; the
  request is answered normally instead of being interrupted mid-answer. If the
  page still reloads (HMR, a manual reload, a server restart), a question form
  restores the answers already chosen from a per-tab draft keyed by interaction
  id, so a long multi-question form resumes where it was left off.

- After an upstream merge, restart the dev server (`pnpm dev:restart-server`)
  before judging the UI. A bundled plugin that upstream added is reconciled
  only at server startup, so until the restart it stays uninstalled and the app
  shows placeholders such as `No thread list plugin is enabled.` even though the
  threads themselves are intact.

The dev flow stays a maintainer surface rather than a shipped product path:
native Windows ships through the supervisor ([README.windows.md](../README.windows.md))
and the `npx bb-app` package, and the repository's remaining development commands
are POSIX-first.
