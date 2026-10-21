# Managed agent runs

Use `--managed` with agent execution when one Automation run must cover a workflow
that spans several turns or child threads. A managed automation creates a fresh
coordinator per run; it cannot target an existing thread. Keep its product controller
responsible for work ownership, review and release gates.

Include `{{runId}}` in the prompt where the controller needs the native run identity.
BB substitutes the actual ID before dispatch. The coordinator's title includes the
scheduled local date. Children should use this coordinator as their direct parent.

The coordinator reads and checkpoints through these commands:

```bash
bb automation run-show <runId> --project <projectId> --json
bb automation checkpoint <runId> --project <projectId> --revision <revision> --state running --wait-for <childThreadId> --summary 'Waiting for the current child' --json
bb automation checkpoint <runId> --project <projectId> --revision <revision> --state running --wake-at <epochMilliseconds> --summary 'Waiting for the next eligible step' --json
bb automation checkpoint <runId> --project <projectId> --revision <revision> --state succeeded --summary 'Verified final report' --json
```

Run checkpoint from the linked coordinator thread. Use the current workflow revision;
a changed revision means pause/resume or another checkpoint won the race. Read the
run again and reconcile controller state. Wait for a live direct child or a deadline,
then end the turn. BB resumes this same coordinator using the saved model, reasoning
and permission settings. There is one unfinished run per automation.

An idle coordinator does not settle a managed run. Explicit `succeeded`, `failed` or
`skipped` checkpoints end it. `paused` and `blocked` retain ownership and keep later
scheduled runs from overlapping. The UI displays these states and links the parent.
A terminal or paused checkpoint requires the currently awaited child to be quiescent.

Native Pause sets `workflow.control` to `pause-requested`. The product controller
finishes its approved current unit, then submits a `paused` checkpoint. It decides
that unit's boundary; BB does not interrupt its child. Native Resume wakes the same
parent immediately, including an unfinished one-shot run whose scheduled time passed.
The controller must still enforce its intake cutoff and mutation gates.

Supervision reacts to thread settlement and reconciles durable state at startup and
on its internal sweep. Queued work, interactions and background agents defer handoff;
provider errors receive a grace period for native retry registration. Ordinary agent
and script automations retain their existing completion behavior.

An uncertain continuation acknowledgement is recorded before any retry. It blocks
instead of sending the same message again. Open the linked parent, inspect its state,
and continue the original controller there; its next valid checkpoint reconciles the
saved intent. An uncertain initial coordinator launch retains its run and requires
inspection before attachment or further action. Never delete a live run to reclaim it.

SDK callers use `bb.sdk.plugins.callRpc` for `automations_run_status` and
`automations_checkpoint`; inputs match the CLI fields using camelCase, with the
coordinator's `threadId`. `automations_get`, `automations_pause` and
`automations_resume` retain their existing project-scoped contracts. Execution changes
and deletion are refused while a managed run owns the automation.
