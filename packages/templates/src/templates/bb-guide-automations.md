---
kind: instruction
title: bb Guide Automations
summary: Command reference for scheduled agent and script work.
intent: Help agents create, edit, inspect, and run automations through the CLI.
---
Automations schedule recurring or one-shot work. Agent automations run a prompt
in a thread; script automations run stored code without model usage.

  bb automation list --project <id>
  bb automation show <automationId> --project <id>
  bb automation create --project <id> --name <name> <schedule> <execution>
  bb automation update <automationId> --project <id> [changes]
  bb automation pause|resume <automationId> --project <id>
  bb automation run <automationId> --project <id>
  bb automation runs <automationId> --project <id> [--limit <count>]
  bb automation delete <automationId> --project <id> --yes

Schedules:

  --cron <expression> --timezone <iana-timezone>
  --at <iso-date-time>
  --in <duration>                 For example: 30s, 5m, 2h, or 1d

Agent execution:

  --prompt <text> --provider <id> --model <model>
  [--permission-mode <accept-edits|auto|full>]
  [--environment <environment-id|path> | --new-environment worktree]
  [--base-branch <branch>] [--machine <id-or-name>] [--target-thread <thread-id>]

Script execution:

  --script <inline> | --script-file <path>
  [--interpreter <bash|sh|node|python3>]
  [--timeout <milliseconds>] [--env-json '{"KEY":"value"}']

Text `list` and `show` output includes the resolved execution target and host.
`--machine` (alias `--host`) applies only to a path-valued `--environment` or a
new worktree. Explicitly targeted scheduled runs wait while that host is
disconnected instead of moving to another machine.

`update` can combine name, schedule, and execution changes. Execution changes
replace the previous execution completely: provide all required agent fields or
a complete script source. This makes mode changes explicit and prevents stale
settings from the previous mode from surviving.

Add `--json` for machine-readable output. Use `runs --output <runId>` to print a
script run's captured output.
