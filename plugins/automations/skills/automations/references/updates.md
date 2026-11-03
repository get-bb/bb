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
  `--provider`, `--model`, `--reasoning`, `--service-tier`, and
  `--permission-mode accept-edits|auto|full`, then choose at most one execution
  target. When changing providers, pass the provider's coherent model,
  reasoning, tier, and permission selection together:

```bash
bb automation update <automationId> --project <id> \
  --environment <environment-id-or-path>
bb automation update <automationId> --project <id> \
  --target-thread <thread-id>
bb automation update <automationId> --project <id> \
  --new-environment worktree [--base-branch <branch>]
```

`--target-thread`, `--environment`, and `--new-environment` are mutually
exclusive. These flags apply only to agent automations; script automations have
no execution environment.

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
