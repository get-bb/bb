---
name: bb-cli
description: "Inspect or manage BB state with the bb CLI; use for BB commands and configuration."
---

# BB CLI

Use bb for BB state and actions. `bb guide` is the reference manual; this skill
says where to look and how to use bb well.

## Start with context

```sh
bb status --json
```

- `bb guide` prints the concepts and the chapter index. `bb guide <chapter>`
  is the full reference for one area.
- `bb guide commands <group>` prints every command in a group with its options.
  `bb <command> --help` shows current flags and defaults.
- references/command-index.md lists every core command path and alias.

## Find the chapter

| Task | Read |
| --- | --- |
| Spawn, fork, message, queue, wait, inspect, retry, stop, or archive threads | `bb guide threads` |
| Worktree setup hooks, environment inspection, commits, pull requests | `bb guide environments` |
| Enroll, create, update, suspend, or remove machines; move the server | `bb guide machines` |
| Projects, sources, attachments, project files | `bb guide projects` |
| Providers, models, service tiers, custom models | `bb guide providers` |
| Dev servers and other long-running commands | `bb guide terminals` |
| Settings, keyboard shortcuts, sidebar preferences, themes, files, voice | `bb guide customization` |
| `AGENTS.md` and skills | `bb guide agent-configuration` |
| Plugins and marketplaces | `bb guide plugins` |
| Scheduled work | the `automations` skill |
| Built-in browser tabs | `bb guide browser` |
| `--json` output shapes and the error envelope | `bb guide json` |
| Writing theme CSS | references/theming.md |

A plugin's commands and settings are documented in that plugin's own skill.
`bb plugin list` shows which commands each plugin contributes.

## Command habits

- Resolve names and IDs with a list or show command before mutation.
- Pass the project explicitly. Pass an environment or machine selector when the
  default host is uncertain, and query provider models on the machine that will
  run the thread.
- Keep file paths on the machine that owns the selected workspace.
- Use `--json` when output controls later work. Parse stdout only: a failure
  prints the error envelope on stdout and the message on stderr, so `2>&1`
  corrupts the JSON.
- Read the whole error before running `--help`; it names the missing flag with
  the current ID filled in.
- Pass long or multi-line text with `--message-file <path>` or
  `--prompt-file <path>` (`-` reads stdin). Inside double quotes the shell runs
  backticks and `$(...)` before bb sees the text.
- Prefer non-interactive commands. Pass `--yes` only for a destructive command
  the user confirmed.
- Inspect real status, logs, and diffs instead of assuming.
- Examples use POSIX shell syntax. In PowerShell, read an environment variable
  as `$env:NAME`, separate commands with `;`, and continue a line with a
  backtick.

## Working with threads

- Give each task one clear owner. Spawn independent tasks separately.
- Give spawned threads clear prompts: objective, constraints, expected
  deliverable, validation to perform, and what to report back.
- Let threads work. Do not poll with shell sleeps or repeated log and status
  reads; use `bb thread wait <thread-id>` when you must block.
- `bb thread tell` steers the active turn by default. Steer for a wrong
  direction, a hard stop, or a critical clarification; use `--mode queue` for
  non-urgent follow-ups. A send reported as `queued` is not a failure; do not
  resend it.
- For a review or fix pipeline, spawn the follow-up with
  `--environment <environment-id>` from `bb thread show <thread-id> --json` so
  it sees the same files.
- To check whether a thread ever received a message, search
  `bb thread log <thread-id> --all`, not the default page.
- Before retrying a failed thread, read `bb thread show <thread-id> --json` and
  `bb thread log <thread-id>`. Treat a thread the user stopped as intentionally
  stopped unless they ask you to continue.

## Safety

- Never move the server, abandon a move, or unlock an old copy without the
  user's explicit confirmation in this conversation. Run
  `bb server move --to <machine> --check`, show them the checklist, and run it
  without `--check` only after they confirm. Never pass `--yes` for them.
- Only the owner can change a machine's permission limit, in the app. Read it
  with `bb machine show <id-or-name> --json` and ask the user to change it.
- Keep secrets out of command arguments, logs, and transcripts.
  `bb machine env set` reads its value from stdin, and enrollment bundles travel
  through a private file or environment variable. Machine and environment inputs
  are persisted and readable, so they never carry credentials. Do not print
  `serverHeaders`.
- Install a registry skill or plugin by its ID. Never infer an install source
  from a display name.

## Common checks

```sh
bb project list --json
bb machine list --json
bb environment providers --json
bb provider list --environment "$BB_ENVIRONMENT_ID" --json
bb thread show "$BB_THREAD_ID" --json
bb thread context --self --json
bb environment status "$BB_ENVIRONMENT_ID" --json
bb plugin list --json
bb skill list --environment "$BB_ENVIRONMENT_ID" --json
```

## Completion

Confirm the command result and any affected thread, environment, plugin, or
remote service. Report the stable ID or URL that the user needs next.
