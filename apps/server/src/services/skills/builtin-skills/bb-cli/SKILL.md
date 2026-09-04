---
name: bb-cli
description: Use this when controlling bb. The bb CLI inspects and manages threads, environments, projects, machines, providers, notifications, skills, plugins, settings, terminals, and other BB services.
---

# BB CLI

Use bb for BB state and actions. Inspect the current context before you choose
IDs, machines, workspaces, providers, or models.

## Start with context

```sh
bb status --json
```

Use JSON when command output controls later work. Use human output for quick
inspection.

Run `bb --version` for the CLI version. Use `bb --help` or `bb help [command]`
for help. Run bb guide for the system overview. Run bb guide <chapter> for one
area. Use bb <group> --help for current flags and defaults.

A standalone CLI targets http://127.0.0.1:38886. Use BB_SERVER_URL and
BB_HOST_DAEMON_PORT only for an intentional non-default target.

## Read only the relevant reference

- Read references/command-index.md to find the exact core command path. Use
  live help for current flags and defaults.
- Read references/configuration.md for settings, agent instructions, skills,
  remote clients, and environment setup scripts.
- Read references/thread-creation.md before you spawn or fork threads, create
  projects, select machines, or create environments.
- Read references/thread-operation.md for messages, queues, interactions,
  panes, terminals, inspection, and long-running commands.
- Read references/failure-recovery.md when a thread fails, stops, or needs plan
  or goal recovery.
- Read references/theme-commands.md for palette and favicon commands. Read
  references/theming.md before you create or edit theme CSS.
- Read references/plugins.md for plugin discovery, install, build, update,
  configuration, runtime, and contributed commands.
- Read references/app-settings.md for complete app setting keys and effects.

## Command habits

- Resolve names and IDs with a list or show command before mutation.
- Pass an explicit project when a command can act across projects.
- Pass an environment or machine selector when the default host is uncertain.
- Query provider models on the machine that will run the thread.
- Prefer non-interactive commands and machine-readable output for automation.
- Pass `--yes` for a confirmed destructive command in a non-interactive shell.
- Treat plugin commands as normal top-level commands after installation.

The builtin Account Pool plugin is disabled by default. Enable it, add Claude
credentials, and inspect its proxy route and account quota with:

```sh
bb plugin enable account-pool
bb pool account add --provider claude --login
printf '%s\n' "$CLAUDE_AUTH_CODE" | bb pool account login-complete --session <id> --code-stdin
bb pool account add --provider claude --import
printf '%s\n' "$ANTHROPIC_API_KEY" | bb pool account add --provider claude --api-key-stdin [--label <text>] [--priority <n>]
bb pool account add --provider claude --api-key <key> [--label <text>] [--priority <n>]
bb pool account list [--json]
bb pool account remove <id>
bb pool account enable <id>
bb pool account disable <id>
bb pool status [--json]
bb pool token rotate --machine <id-or-name>
bb pool bypass <thread-id> [--off]
```

`--login` starts a PKCE session, prints a browser URL and session ID, then
exits. Pipe the manual Claude callback code to `account login-complete` with
that session ID within ten minutes. The code stays out of process arguments,
and the browser and bb server may be on different machines. Newly added or
enabled accounts are available without a plugin reload. With an
enabled account whose secret file remains readable and valid, Claude Code
sessions receive the pool route and a distinct secret token for their machine.
Tokens are never printed. `status` prunes tokens for unenrolled machines and
shows token timestamps plus recently routed threads whose machines need a
local Claude login before the pool can be disabled safely. Rotation keeps the
prior token valid for ten minutes. Agents should pipe API keys to
`--api-key-stdin`;
`--api-key <key>` is an unsafe compatibility form that exposes the key in
process arguments, shell history, and agent transcripts. Prefer `--import` for
an existing Claude Code login. JSON account status
reports rejected upstream bucket resets under `bucketExhaustion`; this
diagnostic field does not affect account selection.

- Inspect real status, logs, API results, or diffs instead of assumptions.
- Keep file paths on the machine that owns the selected workspace.

## Common checks

```sh
bb project list --json
bb machine list --json
bb provider list --environment "$BB_ENVIRONMENT_ID" --json
bb thread show "$BB_THREAD_ID" --json
bb environment status "$BB_ENVIRONMENT_ID" --json
bb plugin list --json
bb skill list --environment "$BB_ENVIRONMENT_ID" --json
```

## Completion

Confirm the command result and any affected thread, environment, plugin, or
remote service. Report the stable ID or URL that the user needs next.
