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

| Platform                      | Setup hook            | Teardown hook            |
| ----------------------------- | --------------------- | ------------------------ |
| macOS, Linux, WSL2            | `.bb-env-setup.sh`    | `.bb-env-teardown.sh`    |
| native Windows                | `.bb-env-setup.ps1`   | `.bb-env-teardown.ps1`   |

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

## Maintainer-only surfaces

Native Windows source-development flows (`pnpm dev`, `pnpm install` from a
native Windows shell) are not part of the shipped product path. Native Windows
support targets the `npx bb-app` package and enrolled host-daemon flows; the
repository itself expects a POSIX shell for development commands.
