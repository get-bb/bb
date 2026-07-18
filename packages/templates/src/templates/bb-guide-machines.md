---
kind: instruction
title: bb Guide — Machines
summary: Command reference for listing and targeting execution machines.
intent: Explain execution-machine discovery and selection from the CLI.
editingNotes: Keep the user-facing noun machine; internal APIs and types use Host.
---
Machine commands

A machine is a host daemon that can run thread environments. Add remote
machines under Settings → Machines.

The Settings installer first uses the exact `bb-app` tarball served by that bb
server at `/install/bb-app.tgz`; only servers that do not implement the route
(HTTP 404) fall back to npm. Installed launchd/systemd services pass
`--auto-update`. On a newer server protocol mismatch, the daemon downloads that
same artifact, installs it globally with npm, and exits for the service manager
to restart. Failed attempts use a persisted exponential backoff that starts at
5 seconds and caps at 5 minutes. A daemon never auto-downgrades to an older
server protocol. Use Settings → Machines or `bb machine retry-update` to bypass
the current backoff after a transient failure.

To opt out, remove `--auto-update` from the launchd plist or systemd user unit
and reload that service. Foreground/manual `bb-app host-daemon` runs leave it off
unless you pass `--auto-update` explicitly.

  bb machine list                         List machines with ID, connection
                                          status, and relative last-seen time
    --json                                Print the raw host list
  bb machine show <id-or-name>            Show machine details
  bb machine join-code                    Create a machine pairing code
  bb machine rename <id-or-name> <name>   Rename a machine
  bb machine retry-update <id-or-name>    Retry a pending daemon update now
  bb machine remove <id-or-name> [--yes]  Revoke and remove a machine
  bb machine provider-cli status <machine>
  bb machine provider-cli install <machine> <claudeCode|codex|cursor>
    --action <install|update>

Machine selectors accept either an exact machine ID or an unambiguous machine
name. `--host` is an alias for `--machine`.

  bb thread spawn --project <id> --machine <id-or-name> --prompt "..."
  bb project create --name "..." --root <path> --machine <id-or-name>
  bb project source add <projectId> --machine <id-or-name> --path <path>

For thread spawning, machine targeting works with an unmanaged workspace path,
a new managed worktree, or the personal workspace. Do not combine it with an
existing environment ID: the reused environment already selects its machine.

For project creation and sources, `--root`/`--path` refers to a path on the
selected connected machine. Omit the selector to keep the existing local CLI
machine fallback (normally the primary machine). Pass `--clone` to source add
instead of `--path` to clone the project's Git remote there; `--remote-url` and
`--target-path` optionally override the clone inputs.
