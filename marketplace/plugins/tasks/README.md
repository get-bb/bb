# Tasks

Tasks is a Linear-style tracker inside bb for planning work, delegating it to
agents, and keeping the task record connected to the threads doing the work.
It provides projects and folders, task keys, statuses and priorities, labels,
subtasks, Markdown comments, attachments, agent presets, and a full CLI.

## Install

Enable **Plugins** under Settings → Experiments, then install Tasks from the
default BB Official marketplace:

```sh
bb plugin install tasks@bb-official
```

The plugin adds the Tasks sidebar panel, the `bb tasks` command, and an agent
skill that teaches workers how to report progress back to tasks.

## Quick start

Create a tracker project and link it to the bb project where delegated agents
should run:

```sh
bb tasks project create \
  --name "Product" \
  --prefix PROD \
  --link-bb-project proj_your_bb_project

bb tasks create \
  --project PROD \
  --title "Ship task delegation" \
  --description "Implement the flow and run focused validation." \
  --priority high

bb tasks list --project PROD
bb tasks show PROD-1
```

When the CLI runs inside a linked bb project, `create` and `list` infer the
tracker project, so `--project` can be omitted. Task keys are case-insensitive
at the CLI boundary.

## CLI reference

Run `bb tasks --help` or `bb tasks <command> --help` for exact options. Add
`--json` to commands when another command or agent will consume the output.

| Command | Purpose |
| --- | --- |
| `bb tasks status` | Show the installed Tasks plugin name and version. |
| `bb tasks project create\|list\|show\|update` | Manage tracker projects, folders, colors, prefixes, and bb-project links. |
| `bb tasks folder create\|list\|update` | Organize tracker projects into nested folders. |
| `bb tasks create` | Create a task with description, priority, labels, due date, and optional parent. |
| `bb tasks list` | Filter tasks by project, status, priority, label, active agents, or search text. |
| `bb tasks show <key-or-id>` | Show the complete task record, including comments, attachments, subtasks, and attached threads. |
| `bb tasks update <key-or-id>` | Update status, priority, title, description, due date, or labels. |
| `bb tasks comment <key-or-id>` | Add a Markdown comment from inline text or a file; optionally notify mentioned threads. |
| `bb tasks attachment add\|get\|list` | Add a task/comment artifact, fetch it to a path, or list a task's attachments. |
| `bb tasks preset list\|create\|update\|delete` | Manage reusable agent execution presets. |
| `bb tasks delegate <key>` | Start and attach a new agent thread using a preset. |
| `bb tasks attach <key-or-id>` | Attach the current bb thread to a task when it was not delegated from Tasks. |
| `bb tasks threads <key>` | List the bb threads attached to a task. |
| `bb tasks label create\|list\|delete` | Manage project-scoped labels. |
| `bb tasks seed-demo --yes` | Create sample folders, projects, labels, tasks, and comments for evaluation. |

Statuses are `backlog`, `todo`, `in_progress`, `in_review`, `done`, and
`canceled`. Priorities are `urgent`, `high`, `medium`, `low`, and `none`.

## Agents, delegation, and presets

Linking a Tasks project to a bb project enables delegation. Open a task, choose
**Delegate**, select a preset, and optionally add instructions. A preset
defines the provider, model, reasoning level, permission mode, and reusable
instructions. Tasks includes starter presets, and custom presets can encode the
worker profile your team uses repeatedly.

Delegation creates a worker thread in the linked bb project, attaches that
thread to the task, and advances a `backlog` or `todo` task to `in_progress`.
The worker receives the task description, subtasks, attachments, recent
comments, preset instructions, and a report-back contract. Its installed Tasks
skill tells it to inspect the task, leave substantive milestone comments,
attach artifacts, and move completed work to `in_review`.

If work begins outside the Delegate action, the agent can associate its current
thread with `bb tasks attach KEY`.

## Task mentions

Type `@` in the bb composer and select **Tasks** to search by task key or title.
Sending the mention gives the agent the task's description, status, priority,
labels, subtasks, attachments, recent comments, attached threads, and CLI
action contract as context. Tasks linked to the current bb project rank first.

Inside a task description or comment, `@` also inserts a task pill. These
references are stored in Markdown as `[PROD-1](bbtask://PROD-1)`, so they remain
portable in task content.

Mentioning a task key such as `PROD-1` in an agent request also activates the
Tasks skill, which directs the worker to read and update the tracked task.
