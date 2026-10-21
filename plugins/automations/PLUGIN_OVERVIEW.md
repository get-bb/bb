Schedule work once or on a repeat, and let bb run it while you do something else. An automation can start an agent thread with a prompt, or run a stored script on the bb server.

## What you get

- An Automations panel in the sidebar. Create, edit, pause, resume, and run automations there. Each automation shows its run history.
- Two schedule types. Use a cron expression with a timezone for repeating work. Use a date, or a delay such as `2h`, for one-shot work.
- Agent mode. Pick the provider, model, reasoning level, and permission mode. Start a new thread, re-prompt an existing thread, or create a new worktree for each run.
- Script mode. Store a bash, sh, node, or python3 script. Each run records stdout, stderr, and the exit code. A script that prints nothing is recorded as a silent tick.

## For agents

Agents get the `automations` skill and the `bb automation` command: `create`, `list`, `show`, `update`, `pause`, `resume`, `run`, `runs`, and `delete`. All commands accept `--json`. Threads that an automation starts cannot create automations.

Scripts run on the machine that hosts the bb server. New standard-project scripts use that host's project source when available; Personal and projects without one run in the plugin's shared script storage. Existing scripts run there until changed. A script can instead select an absolute server-host path, and its detail view shows the resolved directory. Agent runs use the providers you already have installed.

Core Next step acceptance creates a disabled one-shot automation through `automations_create`, then starts the work immediately through `automations_run` with the suggestion ID as its idempotency key. The future trigger records the notification time; the disabled schedule prevents a second run. Agent execution carries `resultNotificationKind: "day2_result"` and `day2ResultDelivery: {acceptedAt, deliverAt}`. Both times are positive epoch milliseconds within the Date range, delivery follows acceptance, and the one-shot trigger time must equal `deliverAt`. Day-two results require a new thread, without `targetThreadId`.

At spawn, Automations seeds its thread metadata with `day2Result: {pending: true, automationId, acceptedAt, deliverAt}` for the existing push-notifications pipeline. That plugin owns delayed delivery and cancellation. Existing executions without delivery timing keep their original pending-only marker and scheduled-run behavior; ordinary automations omit both fields. Undo cancels pending delivery before core calls `automations_delete`; it does not reverse work already performed. The same RPC paths are available through `sdk.plugins.callRpc`; `bb thread next-step accept` and `bb thread next-step undo` expose the core workflow.
