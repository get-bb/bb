Schedule flags:

```text
--cron <expr>                  Recurring 5-field cron expression
--timezone <tz>                IANA timezone for --cron
--at <datetime>                One-shot run time, preferably ISO 8601
--in <duration>                One-shot delay, e.g. 30s, 5m, 2h, 1d
```

Agent mode flags:

```text
--prompt <prompt>              Prompt to run when due
--provider <id>                Optional provider override
--model <model>                Optional model override
--reasoning <level>            Level id the model lists, such as low, medium, or high
--service-tier <tier>          Literal tier id the provider lists, including none
--clear-service-tier           Clear the tier; cannot combine with --service-tier
--permission-mode <mode>       accept-edits, auto, or full
--target-thread <id>           Reuse/re-prompt an existing thread
--environment <id-or-path>     Existing environment ID or unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
```

For `bb automation create --prompt "..."`, omitted provider/model values come
from the calling thread (`BB_THREAD_ID`), then the project's remembered
new-thread choices. Without remembered choices, bb uses the user's default
provider (or the first available provider) and its catalog default model.
Explicit flags win. Changing only `--provider` uses a default model for that
provider, never the calling thread's model from a different provider.
Defaults are saved when the automation is created. Partial `update` commands
keep the automation's existing execution values for omitted flags.

When `--permission-mode` is omitted, the plugin chooses Approve for me
(`auto`) when the provider supports it and otherwise uses Full Access
(`full`).

Script mode flags:

```text
--script <inline>              Inline script content
--script-file <path>           Copy script content from a file on a host
--host <name-or-id>            Host that owns --script-file (default: thread host or server)
--interpreter <name>           bash, sh, node, or python3
--timeout <duration>           Bare number of milliseconds or a duration with a
                               unit (90s, 5m); default 120000, max 900000
--env-json <json>              Script variables as a string-to-string JSON object
--working-directory <value>    automation-storage, project, or an absolute server-host path
```
