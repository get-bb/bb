---
name: tasks
description: Use when asked to work on or track a task in the Tasks plugin, when the prompt mentions a task key such as ABC-12, or when work needs task comments, attachments, delegation tracking, or status updates.
---

# Tasks

Use the `bb tasks` CLI to understand the assigned task, keep its record useful,
and report the outcome where the work is tracked.

Delegation presets are user-defined; Tasks ships with none. Before dispatching
work, use `bb tasks preset list` and create a preset if the required one does
not already exist. Dispatch requires an existing preset.

## Work a task

1. Find and read the task before acting:

   ```sh
   bb tasks show ABC-12
   ```

   The detail includes the description, status, priority, labels, subtasks,
   comments, attachments, and attached worker threads. Use
   `bb tasks show ABC-12 --json` when the result will drive commands or code.

2. Fetch every relevant attachment before making assumptions about it:

   ```sh
   bb tasks attachment get <attachment-id> --out <path>
   ```

3. Do the work. Post one substantive comment at each meaningful milestone,
   such as a completed investigation, an implementation ready for validation,
   or a concrete blocker:

   ```sh
   bb tasks comment ABC-12 --body "Implemented the change; focused validation now passes."
   ```

4. Attach result artifacts that belong with the task, such as reports,
   screenshots, patches, or generated files:

   ```sh
   bb tasks attachment add ABC-12 --file <path>
   ```

   Use `--json` when capturing the returned attachment metadata.

5. When the work is ready for review, update the task:

   ```sh
   bb tasks update ABC-12 --status in_review
   ```

   If the work cannot proceed, leave the status accurate and comment with the
   specific blocker, what you tried, and what would unblock it. Do not mark a
   blocked task complete.

6. Delegated threads are attached automatically. If this thread was not
   delegated from Tasks, attach it yourself so the task shows the active work:

   ```sh
   bb tasks attach ABC-12
   ```

## Invariants

- Valid task statuses are `backlog`, `todo`, `in_progress`, `in_review`,
  `done`, and `canceled`.
- Use `in_review` when implementation is complete but still needs human or
  agent review. Use `done` only when the task's completion criteria are met.
- Write one comment per meaningful milestone. Combine related facts into a
  useful update; never spam progress pings, command-by-command narration, or
  repeated status messages.
- Comments should say what changed or was learned, what validation ran, and any
  remaining risk or blocker.
- Prefer stable task keys such as `ABC-12` for task commands. Use `--json` for
  machine-readable output and human output for quick inspection.
