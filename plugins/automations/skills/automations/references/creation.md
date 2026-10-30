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
--provider <id>                Provider ID
--model <model>                Model ID
--reasoning <level>            Level id the model lists, such as low, medium, or high
--service-tier <tier>          Literal tier id the provider lists, including none
--clear-service-tier           Clear the tier; cannot combine with --service-tier
--permission-mode <mode>       accept-edits, auto, or full
--option <option-id>=<value>   Option the model lists (bb provider models); repeatable
--target-thread <id>           Re-prompt an existing thread instead of spawning one per run
--environment <value>          project-default (the default), an existing environment ID,
                               or an unmanaged workspace path
--new-environment <kind>       Create a new environment (worktree)
--base-branch <branch>         Base branch for new managed worktrees
--environment-provider <id>    Environment provider ID (bb environment providers --project <id>)
--environment-inputs <json>    Inputs the provider declares, such as a Worktree base branch
--machine <id-or-name>         Machine for a workspace path, --new-environment, or a provider
--new-machine <provider-id>    New machine for every run; requires --environment-provider
--machine-inputs <json>        Inputs for --new-machine or a composed provider's new machine
```

The environment flags follow `bb thread spawn`, with its errors, except:

- `--host` is not an alias of `--machine`: here it names the host that holds
  `--script-file`.
- Without `--machine`, the machine is the invoking thread's, not the local
  daemon's (see below), and `--machine` must name a persistent machine, since
  every run would fail once a temporary one is removed.
- `--new-environment` takes only `worktree`.

`--environment`, `--new-environment`, `--environment-provider`, and
`--target-thread` are mutually exclusive.

A workspace path, `--new-environment worktree`, and an environment provider
that runs on an existing machine use `--machine`. Without it they pin the
machine of the thread that runs the command; outside a thread, or from a thread
on a temporary machine, they pin the bb server's machine. `--machine` alone runs
each thread in the project's checkout on that machine, or in its personal
workspace for Personal.

An environment provider must be able to run on that machine for the project;
`bb environment providers --project <id> --machine <id-or-name>` lists the ones
that can. A composed provider, such as berth, creates a new machine for every
run, so it refuses `--machine` and `--new-machine`; pass its machine's inputs
with `--machine-inputs` when it needs them. A provider takes its branch through
`--environment-inputs`, never `--base-branch`:

```bash
bb automation create --project <id> --name "Nightly review" \
  --cron "0 6 * * *" --timezone UTC \
  --prompt "Review yesterday's merges" --provider <id> --model <model> \
  --environment-provider git-worktree \
  --environment-inputs '{"branch":{"kind":"named","name":"main"}}' \
  --machine <id-or-name>
```

`--option` sets one option the model lists; `true` and `false` become on/off
values. Repeat it for each option. The plugin checks each option against the
model on the chosen machine when you save, and refuses options with
`--target-thread`, whose runs re-prompt a thread instead of starting one.

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
