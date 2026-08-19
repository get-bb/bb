# Tasks

Tasks is a Linear-style tracker inside bb for planning work, delegating it to
agents, and keeping the task record connected to the threads doing the work.
It provides projects and folders, task keys, statuses and priorities, labels,
subtasks, Markdown comments, attachments, agent presets, and a full CLI.

## Install

Install Tasks from the official plugins that BB includes:

```sh
bb plugin install tasks
```

The plugin adds the Tasks sidebar panel, the `bb tasks` command, and an agent
skill that teaches workers how to report progress back to tasks.

## Quick start

Install the plugin with `bb plugin install tasks`. Then use the `bb tasks` CLI
to create a tracker project. Link it to the bb project where delegated agents
will run:

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
bb tasks preset list
bb tasks delegate PROD-1 --preset "GPT-5.6 · high"
```

When the CLI runs inside a linked bb project, `create` and `list` infer the
tracker project, so `--project` can be omitted. Task keys are case-insensitive
at the CLI boundary. You can also delegate from a task's **Delegate** menu,
choose or create presets under **Manage → Presets**, and type `@` in the bb
composer to send a task mention to an agent.

The comment composer shows a **Notify last responding agent** switch. When the
task has an agent reply, leave it on to send the new comment to the thread that
authored the latest reply, resuming that thread when it is idle. Turn it off to
keep the comment in Tasks only. If no agent has replied, the disabled control
says so explicitly. Agents and scripts can use the same behavior with
`bb tasks comment PROD-1 --body "New context" --notify`.
When run from a thread, the CLI preserves that agent thread and any explicit
`--author`; notification still targets the prior latest responder rather than
the newly recorded agent comment itself.

## CLI reference

Run `bb tasks --help` or `bb tasks <command> --help` for exact options. Add
`--json` to commands when another command or agent will consume the output.
File paths (`--file`, `--attach`, `--out`, `--description-file`, `--body-file`)
resolve on the invoking machine: inside an agent thread that is the thread's
machine, otherwise the server's machine; pass `--machine <id-or-name>` to
target another enrolled machine.

| Command                                        | Purpose                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bb tasks status`                              | Show the installed Tasks plugin name and version.                                                                                          |
| `bb tasks project create\|list\|show\|update`  | Manage tracker projects, folders, colors, prefixes, and bb-project links.                                                                  |
| `bb tasks folder create\|list\|update\|delete` | Organize tracker projects into nested folders. Deleting a folder moves its projects and subfolders to the top level; no tasks are deleted. |
| `bb tasks create`                              | Create a task with description, priority, labels, due date, optional parent, and file attachments (repeatable `--attach <path>`).          |
| `bb tasks list`                                | Page/filter tasks by project, status, priority, label, active agents, or search text; supports `--sort`, `--limit`, and `--cursor`.        |
| `bb tasks show <key-or-id>`                    | Show the complete task record, including comments, attachments, subtasks, and attached threads.                                            |
| `bb tasks update <key-or-id>`                  | Update status, priority, title, description, due date, or labels.                                                                          |
| `bb tasks comment <key-or-id>`                 | Add a Markdown comment from inline text or a file; optionally notify the latest responding task agent.                                     |
| `bb tasks attachment add\|get\|list\|remove`   | Add, fetch, list, or remove attachments. Referenced attachments require `remove --remove-references`.                                      |
| `bb tasks preset list\|create\|update\|delete` | Manage reusable agent execution presets.                                                                                                   |
| `bb tasks delegate <key>`                      | Start and attach a new agent thread using a preset.                                                                                        |
| `bb tasks attach <key-or-id>`                  | Attach the current bb thread to a task when it was not delegated from Tasks.                                                               |
| `bb tasks threads <key>`                       | List the bb threads attached to a task.                                                                                                    |
| `bb tasks label create\|list\|delete`          | Manage project-scoped labels.                                                                                                              |
| `bb tasks seed-demo --yes`                     | Create sample folders, projects, labels, tasks, and comments for evaluation.                                                               |

Statuses are `backlog`, `todo`, `in_progress`, `in_review`, `done`, and
`canceled`. Priorities are `urgent`, `high`, `medium`, `low`, and `none`.

Task lists default to 100 rows and accept `--limit 1-500`. JSON output is
`{ tasks, nextCursor, limit }`; human output prints the continuation option
when another page exists. The cursor is opaque and tied to the filters, sort,
and current task-list revision. If tasks are added, removed, reordered, or
updated between requests—or label links/names, active task threads, or project
prefixes change—the old cursor is rejected. Restart from the first page rather
than traversing an inconsistent snapshot.

## Agents, delegation, and presets

Linking a Tasks project to a bb project enables delegation. Open a task, choose
**Delegate**, select a preset, and optionally add instructions. A preset
defines the provider, model, reasoning level, permission mode, and reusable
instructions. Presets are user-defined, so create the worker profiles your team
uses repeatedly before dispatching work.

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

## Known limitations

- The **Auto** delegation preset is deferred; choose an explicit preset.
- List filters are local UI state and are not persisted in the URL.

## Fast follow

- Batch task-list enrichment for comments and attached-thread state.
- Add notifications and an inbox for task activity.
- Add a command palette entry for Tasks to cmd-K.
