Schedule work once or on a repeat, and let bb run it while you do something else. An automation can start an agent thread with a prompt, or run a stored script on the bb server.

## What you get

- An Automations panel in the sidebar. Create, edit, pause, resume, and run automations there. Each automation shows its run history.
- Two schedule types. Use a cron expression with a timezone for repeating work. Use a date, or a delay such as `2h`, for one-shot work.
- Agent mode. Pick the provider, model, reasoning level, and permission mode. Start a new thread, re-prompt an existing thread, or create a new worktree for each run.
- Script mode. Store a bash, sh, node, or python3 script. Each run records stdout, stderr, and the exit code. A script that prints nothing is recorded as a silent tick.

## For agents

Agents get the `automations` skill and the `bb automation` command: `create`, `list`, `show`, `update`, `pause`, `resume`, `run`, `runs`, and `delete`. All commands accept `--json`. Threads that an automation starts cannot create automations.

Scripts run on the machine that hosts the bb server. New standard-project scripts use that host's project source when available; Personal and projects without one run in the plugin's shared script storage. Existing scripts run there until changed. A script can instead select an absolute server-host path, and its detail view shows the resolved directory. Agent runs use the providers you already have installed.

Live reads declare contract tags. CLI changes and background runs invalidate the same project reads as UI mutations. A failed refresh preserves loaded rows and prompt drafts with an inline Retry; returning to script detail rereads its file.

The `automations_run_pages` RPC batches run-history pages for keyed readers. Each key is a JSON-encoded positional window (`projectId`, `automationId`, `offset`, and optional `limit`); the response maps each original key to its page. Positional windows keep the loaded history contiguous when new runs arrive. All keys are validated before any page is read, with at most 200 keys per request. It is available through the plugin RPC SDK and `bb plugin rpc call automations automations_run_pages --input-file <path>`; the ordinary `bb automation runs` command retains its cursor pagination.
