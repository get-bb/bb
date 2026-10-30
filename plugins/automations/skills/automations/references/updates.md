`list` and `show` are diagnostic reads: a damaged record remains visible as
`Prompt required` or `Invalid data` instead of failing the whole read. A
`Prompt required` record opens in the Automations panel's standard editor,
where the user can add its prompt while reviewing the other settings. It can
also be repaired directly:

```bash
bb automation update <automationId> --project <id> --prompt "<prompt>"
```

Writes remain strict. Run, pause, and resume reject damaged records; update
succeeds only when the resulting complete record is canonical. Every successful
create/update persists the canonical format.

Choose one of three execution update forms:

- A partial agent update preserves every omitted execution field and edits the
  existing agent automation in place. Use any combination of `--prompt`,
  `--provider`, `--model`, `--reasoning`, `--service-tier`,
  `--permission-mode accept-edits|auto|full`, and `--option` or
  `--clear-options`, then choose at most one execution target. When changing
  providers, pass the provider's coherent model, reasoning, tier, permission,
  and options together:

```bash
bb automation update <automationId> --project <id> \
  --environment project-default
bb automation update <automationId> --project <id> \
  --environment <environment-id-or-path> [--machine <id-or-name>]
bb automation update <automationId> --project <id> \
  --target-thread <thread-id>
bb automation update <automationId> --project <id> \
  --new-environment worktree [--base-branch <branch>] [--machine <id-or-name>]
bb automation update <automationId> --project <id> \
  --environment-provider <id> [--environment-inputs <json>] \
  [--machine <id-or-name> | --new-machine <provider-id>] [--machine-inputs <json>]
```

`--target-thread`, `--environment`, `--new-environment`, and
`--environment-provider` are mutually exclusive. These flags apply only to
agent automations; script automations have no execution environment.
`--environment project-default` turns an automation that re-prompts a target
thread back into one that spawns a new thread per run in the project's default
environment.

Any environment flag replaces the whole stored environment; nothing carries
over from the previous one. `--machine <id-or-name>` alone therefore moves the
automation to the project's checkout on that machine, and moving a provider
environment means repeating `--environment-provider` and its inputs with the
new `--machine`. Without `--machine`, a workspace path, `--new-environment
worktree`, and a provider on an existing machine pin the machine of the thread
that runs the command; outside a thread, or from a thread on a temporary
machine, they pin the bb server's machine. [creation.md](creation.md) lists the
provider, composition, and input rules.

`--option <option-id>=<value>` replaces every stored option with the ones given;
`--clear-options` removes them, and the two cannot be combined. Options belong
to a provider: changing `--provider` without `--option` drops them, and so does
`--target-thread`.

- A partial script update preserves every omitted execution field and edits the
  existing script automation in place. Use any combination of `--script` or
  `--script-file`, `--interpreter`, `--timeout`, `--env-json`, and
  `--working-directory`. `--env-json` replaces the whole variable map; pass
  `'{}'` to remove every variable. A new `--script-file` keeps the current
  interpreter, so pass `--interpreter` when the new file needs another one:

```bash
bb automation update <automationId> --project <id> --script-file ./check.sh
bb automation update <automationId> --project <id> --env-json '{"CHANNEL":"qa"}'
bb automation update <automationId> --project <id> \
  --working-directory automation-storage|project|<absolute-server-path>
```

- A complete replacement discards the previous execution. `--prompt`,
  `--provider`, and `--model` together always replace the execution with an
  agent, even on an agent automation; add `--reasoning` and `--service-tier`
  when needed. Script flags on an agent automation replace
  it with a script and require `--script` or `--script-file`. Include every
  desired mode-specific setting; omitted ones take their creation defaults.
  Agent and script flags cannot be combined.

Every command supports `--json`. For `list` and `show`, the JSON result is a
union discriminated by `problem`: canonical records omit it, while degraded
records use `"missing-agent-prompt"` or `"invalid-stored-data"`. The
missing-prompt variant retains the full readable automation; the invalid-data
variant contains only `id`, `projectId`, `name`, and `problem`.

In text, `show` and `list` describe where each run's thread works, such as
`Worktree on laptop · from main`, and `show` lists the stored options. In
JSON, an agent execution carries the stored `environment` (an environment
provider's `environmentProviderId`, `machine`, and `inputs`) and
`sessionOptions`.
