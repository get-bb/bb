---
name: pi-provider
description: "Use BB Pi background tasks, message editing, and context compaction."
---

# Pi provider

Pi supports editing and rerunning eligible user messages and compacting idle or
errored threads through the core `bb thread edit-message` and `bb thread compact`
commands. Inspect the thread first and use live command help for arguments.
Provider confirmation determines whether the operation completed.

Use the target host's provider catalog for available models and execution options.

## Background shell tasks

Use `background_task` for a shell command that should run while the agent continues
other work. Supply `command` and a short `description`; `cwd` defaults to the session
workspace and `timeout_sec` is an optional positive wall-clock limit. The command
uses the platform shell (`sh` on POSIX, `cmd.exe` on Windows). Launch returns a task ID and an output-file path.
BB shows the task's running and terminal states in a card. Completion delivers a
short output tail automatically during the active run or starts an idle follow-up.
Do not poll or arrange a separate callback. Read the returned file for full output.

Use `background_task_cancel` with `taskId` to terminate a task's process tree.
Tasks belong to the launching BB thread; another thread or fork cannot cancel them.
Ordinary turn completion keeps them running. Explicit thread stop, release, discard,
archive, or deletion cleans up work through session teardown. A provider restart
terminates the owned workers and reports recovered pending tasks as failed.
Execution-setting changes preserve running tasks in the same thread.

Outputs and the pending-task registry live under
`<workspace>/.bb-pi-bg/<thread-owner-hash>/`. BB owns these files; they are output
artifacts, not configuration. Finished output files remain available to read.

The same workflow is available in the GUI or a CLI/SDK-created Pi thread. For example:

```sh
bb thread spawn --provider pi --prompt 'Use background_task to run sleep 20; echo DONE, then write a haiku. React when completion arrives.'
bb thread log <thread-id> --all --json
```
