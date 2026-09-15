# Moving the bb server to another machine

Status: built on this branch behind the default-off `serverMove` experiment
(`bb settings experiment serverMove true`). The server-machine wording, badge,
explainer, add-machine notice, and the Role column in `bb machine list` ship
without the experiment. Implementation contracts live in the code; this document
records the product decisions.

## Goal

Today one computer runs the bb server and every other machine connects to it,
but nothing lets a user make a different computer the server. Someone who
started on a laptop and later bought an always-on desktop has no path except
starting over. "Move server here" copies the server to another machine, points
everything at it, and keeps the old computer working as a regular machine.

## Decisions

### Model

- The server is a role, not "the main computer". The server machine runs the bb
  server: the database, thread history, settings, plugin state, and remote
  access. Every machine, including the server machine, can run agents.
- A move copies server-owned data only. Every machine keeps its host ID and its
  files where they are. Worktrees, thread storage, project checkouts, and
  provider sessions stay on the machines that own them, and host-scoped paths in
  the database are never rewritten.
- The old server machine becomes a regular machine and keeps running its own
  threads.
- User-facing text says "server" and "server machine". The SDK and API keep
  `primaryHostId`, because it is published and plugins read it.

### Scope

- v1 supports a planned move: the old server is online and cooperates.
  Replacing a dead server from a backup and automatic failover are out of scope.
- Targets: any persistent machine, including provider-managed persistent
  machines such as cloud VMs. While a provider-managed machine is the server,
  suspend and remove are disabled, the provider's periodic sweeps skip it, and
  its provider plugin cannot be uninstalled. Ephemeral sandboxes cannot be
  targets.
- Both bb connect and direct-address setups are supported.

### What moves

Moved: `bb.db` (consistent snapshot), `config.json`, `env.json`, `auth-secret`,
`machine-environment-key`, `attachments/`, `plugins/<id>/data.db`,
`plugins/<id>/secrets/`, plugin-owned server files such as automation scripts
and task blobs, installed npm/git plugin packages, plugin state snapshots,
`skills/`, `theme/`, `AGENTS.md`, and `telemetry-id`.

Not moved: logs, caches (`install-cache/`, `plugin-host-artifacts/`,
`skills-generated/`, toolchains), runtime files, and every host-owned file
(`host-id`, `auth.json`, `thread-storage/`, `plugins/<id>/host-data/`,
`plugins/<id>/bridge-data/`, checkouts, provider session stores).

### Flow

1. **Checklist** (`bb server move --to <machine> --check`, and the first screen
   of the dialog). It never copies personal CLI logins between machines. It
   lists:
   - running turns and scheduled automations;
   - offline machines (warning only);
   - path-installed plugins whose source directory is not on the target;
   - Docs vaults with no machine binding;
   - `gh` and Codex logins and local tools the server uses that the target lacks;
   - a timezone difference that shifts core plugin schedules;
   - existing bb server data on the target, which is archived to
     `~/.bb.before-move-<date>` after confirmation and never merged;
   - free disk space in the target's data directory for the export, its
     unpacked copy, and the bb update, with headroom (a blocker when it is
     short, a warning when it is tight);
   - a target that runs a newer bb than the server, which blocks the move until
     the server is updated;
   - the server's custom models, ACP agents, and shared skill roots, which
     replace the target's own.
2. **Confirm** once, in the app or CLI that starts the move. The target does not
   confirm; the server can already run commands on any enrolled machine.
   "Stop all and move" interrupts running turns and pauses schedules.
3. **Align versions:** install the server's exact bb version on the target
   through the existing machine update artifact. The update stays on the
   target even if the move is cancelled.
4. **Freeze and copy:** the old server stops accepting writes and streams an
   export over the target's existing daemon connection, which only that target
   may download, checked end to end with a SHA-256 digest.
5. **Start:** the target imports the export, installs a background service that
   runs server and daemon and starts on boot, and must pass a health check
   before anything switches.
6. **Switch:**
   - bb connect: the connect credential travels in the database. The old server
     drops its tunnel before the new server connects it, and machines and apps
     keep using the same URL.
   - Direct address: the dialog asks for the new server address. Connected
     machines verify they can reach it, then switch before cutover.
7. **Lock the old copy:** bb on the old computer refuses to start a server from
   that data and restarts as a regular machine connected to the new server.

Every connected app shows a full-screen "Moving server to <machine>" with the
steps and reconnects when done. The move continues if the app that started it
closes; `bb server move status` shows the same steps.

### Addresses and clients

- Offline machines (direct address): the old computer keeps answering at the old
  address with the new one for as long as bb runs there, so they switch when
  they come back. If that cannot work, Settings → Machines shows a one-line
  command to run on that machine.
- On the old computer, the desktop app and CLI point at the new server
  automatically and show a one-time "Your server moved to <machine>" notice.
  Browser tabs on the old local address redirect.
- Mobile and desktop profiles on other devices keep working unchanged with bb
  connect. With a direct address, they learn the new address from the old one
  the same way machines do.

### Safety

- Any failure before the switch resumes the old server untouched and cleans up
  the target. A move can be cancelled until the switch.
- After the switch there is no undo; moving back is another move.
- The locked old copy stays until the user deletes it from that machine's page
  or with `bb server delete-old-copy` on that computer.
- `bb server unlock` on the old computer restarts the old copy as a last resort.
  It warns that everything since the move is lost and that the new server must
  be stopped first.
- `bb server import` writes `server-connect-hold.json`, so the imported server
  starts without bb connect and can't take the original server's tunnel.
  `bb server allow-connect` removes the hold after the original server is
  stopped. A move never writes the hold.
- An imported server only finishes its import (path fixups and machine roles)
  while the `serverMove` experiment is on; otherwise it keeps
  `server-import.json` and logs why.

### Export files

`bb server export` works on a running server through an online SQLite snapshot,
so backups need no downtime. Exports are gzip tar archives and are not
encrypted: they hold the server's credentials and plugin secrets. The CLI writes
them with mode 0600, keeps the file only when it matches the SHA-256 digest the
server sent, and warns that the file must stay private. `bb server import` runs
locally on a machine with no server running, tells the user to re-export an
archive encrypted by an older bb, and refuses, before installing anything, an
export whose manifest records the `serverMove` experiment as off on the server
that wrote it.

## Surfaces

Everything below requires the `serverMove` experiment. While it is off, the
server refuses check, start, export, and old-copy deletion with 403
`server_move_experiment_disabled`, and the app hides Move server here, its
explainer line, and the old server copy section. Move status and cancel stay
available.

UI:
- "Move server here" in a machine's row menu and on its machine page, for
  persistent, connected, active machines that are not the server.
- A move dialog with the checklist, the new address when required, the archive
  confirmation, and "Stop all and move".
- A full-screen move overlay in every connected app.
- The old computer's machine page shows the locked old server copy with a Delete
  action.

CLI (`bb server`):

```
bb server move --to <machine> [--address <url>] [--check] [--archive-existing-data] [--yes] [--json]
bb server move status [--json]
bb server move cancel [--json]
bb server export --out <file> [--json]
bb server import <file> [--data-dir <dir>] [--yes] [--json]
bb server unlock [--data-dir <dir>] [--force] [--yes] [--json]
bb server allow-connect [--data-dir <dir>] [--yes] [--json]
bb server delete-old-copy [--data-dir <dir>] [--yes] [--json]
```

`import`, `unlock`, `allow-connect`, and `delete-old-copy` run locally and do
not call a server.

Routes and SDK (`docs/api_to_audit.md` covers stabilization):

| Route | SDK |
| --- | --- |
| `POST /api/v1/server/move/check` | `experimental_server.checkMove` |
| `POST /api/v1/server/move` | `experimental_server.startMove` |
| `GET /api/v1/server/move` | `experimental_server.moveStatus` |
| `POST /api/v1/server/move/cancel` | `experimental_server.cancelMove` |
| `POST /api/v1/server/export` | `experimental_server.export` |
| `DELETE /api/v1/hosts/:id/old-server-copy` | `hosts.experimental_deleteOldServerCopy` |

All refuse requests authenticated by a machine credential.

## How it works

- **Where the new server lives:** the target's existing daemon data directory
  (for example `~/.bb-machines/<old-server-host>`). The target keeps its host id,
  worktrees, and thread storage; its service definition switches from
  `bb-app host-daemon` to `bb-app start --data-dir <dir>`, or a detached
  `bb-app start` when there is no service manager. The `host-id` file in that
  directory makes it the server machine.
- **Markers:** `server-import.json` on the target while the imported server is
  pending (no plugins, sweeps, telemetry, or daemon sessions), `server-moved.json`
  on the old computer after the switch, `last-server-move.json` on the new
  server, and `server-connect-hold.json` after a manual import until
  `bb server allow-connect`.
- **Before export:** running turns stop, plugin schedules pause, and every plugin
  except bb connect is suspended so nothing writes after the snapshot. SQLite
  databases are copied with the online backup API.
- **Switch order:** write the lock and the old computer's `config.json`, send
  `server_move.activate` while the tunnel is still up (retrying while the
  target session exists), stop plugins (the old tunnel closes), send
  `server.moved` to machines that need a new address, and retire the old server.
  The target replies to activate, waits for its session to the old server to
  close, stops the pending server, and swaps its service. A refused activation
  rolls the old server back. A lost reply commits, and the target finishes
  activation on its own, from its persisted state or from a matching 410.
- **The old computer:** the `bb-app` launcher sees the lock, runs the daemon
  against the new address, and answers the old port with 410 `server_moved`
  (HTML requests redirect in direct mode). Moving the server back releases that
  port while the import is pending and returns to a normal start once the lock
  is gone.

## Not built yet

- Settings → Machines does not yet show a command for machines that stay offline
  through a direct-address move and cannot reach the old computer.
- Uninstalling the provider plugin that manages a provider-managed server
  machine is not blocked yet (suspend, resume, and provider sweeps are).
- No UI for export or import; they are CLI and SDK only.

## Verification

Done on this branch:
- Unit and integration suites for every touched package, including fail-before
  mutations of the key guards (activation ordering, freeze, allowlists, systemd
  escaping, launcher moved mode).
- An end-to-end run with packaged `bb-app` installs in isolated homes on one
  Linux host, direct addresses, no service manager: experiment refusal, move
  A→B, remote old-copy deletion, launcher restart in moved mode, and a move back
  B→A.

Not verified yet:
- A bb connect move against the real gate.
- launchd and systemd service swaps on real machines, and the desktop and mobile
  apps switching over.
- Offline machines switching through the old address, and provider-managed
  targets.
