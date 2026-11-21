# Agent instructions

This package measures and tests the text that bb's bundled plugins add to every agent thread: the plugin instructions, the skill list, and the agent tools.

It has two parts:

- **The budget test** runs in CI. It loads every bundled plugin in the SDK's fake host and measures what each plugin adds. A plugin that goes over its budget in `src/budget.ts` fails the test. The plugins that a new install has and turns on (`autoInstall` and `defaultEnabled`) have a total budget. The test also caps each skill description at 140 characters.
- **The eval** runs a real model. CI does not run it. It replays cases in Claude Code with bb's text and a fake `bb` CLI, and it checks what the agent does.

Run the eval when you change text that an agent sees. This includes `contributeInstructions`, the `instructions` of `agents.configure`, tool descriptions, and the `description` in a SKILL.md.

## See the size

```sh
pnpm --filter @bb/agent-instructions-eval context
pnpm --filter @bb/agent-instructions-eval context -- --text
```

The report gives the characters each plugin adds. A token is about 4 characters. `--text` also prints the system text that bb appends.

The memory plugin is measured with no stored memories. Its catalog of stored memories has its own limit, `CATALOG_MAX_CHARS` in `plugins/memory/server.ts`.

## Run the eval

The eval runs `claude -p` with your Claude Code login. It needs no API key. Each sample is a new Claude Code session in a temporary directory:

- The session gets bb's system text through `--append-system-prompt`, the same way the Claude Code provider appends it.
- The session gets the bundled skills as the `bb-global-skills` plugin.
- The enabled plugins' agent tools come from a fake MCP server named `bb-bridge`, with their real descriptions and schemas. A tool call returns the case's `toolResults` entry for that tool, or `{"ok":true}`.
- `--setting-sources project` and `--strict-mcp-config` keep your own settings, hooks, CLAUDE.md, and MCP servers out of the run.
- The agent can run only `bb` in the shell, and it can read only the temporary directory and the skill files. It can edit only the workspace, and only when the case lets it. A fake `bb` on `PATH` records each call and gives the case's canned output. `bb guide` gives the real guide text from `packages/templates`.

The eval runs on Linux and macOS. It does not run on Windows.

```sh
cd tests/agent-instructions
pnpm eval --case voice-memo-uses-bb-voice --samples 1 --out runs/check
pnpm eval --out runs/before
pnpm eval --out runs/after --baseline runs/before/results.jsonl
```

Flags:

- `--out <dir>` is required. The run writes `results.jsonl` and `summary.md` there. `runs/` is ignored by git.
- `--model <id>` sets the model. The default is `sonnet`.
- `--case <id>` selects a case. Repeat it to select more cases.
- `--samples <n>` sets the samples per case. The default is 3. A case fails when half or more of its samples fail.
- `--concurrency <n>` sets the samples that run at the same time. The default is 4.
- `--baseline <results.jsonl>` adds the pass rates of an earlier run to the summary.
- `--without-bb-text` sends no bb system text. Use it to show that a case tests the text: a `bad` case must fail without the text.
- `--dry-run` loads the cases and the text, and calls no model.

Cost: a full run of 21 cases at 3 samples cost about $2.50 on Sonnet on 2026-11-21, in Claude Code's own estimate. A subscription login uses plan usage, not money.

## Add a case

Cases are JSON lines in `cases/`. `src/cases.ts` has the schema.

- `kind`: `bad` reproduces a real mistake, `guard` protects correct behavior, and `control` is ordinary work.
- `source`: the pull request, issue, or text that the case comes from. `experience`: the mistake or the behavior, in one sentence.
- `plugins`: plugins to enable that are off by default.
- `parentThreadId`: the parent of the thread. bb gives a child thread extra instructions.
- `files`: files in the temporary workspace. `allowEdits` lets the agent edit them.
- `toolResults`: a list of `{ tool, result }`; `result` is the text a `bb-bridge` tool call returns.
- `bb.status`: the output of `bb status`. `bb.responses`: a list of `{ args, stdout, exitCode }`, where `args` is a regular expression for the arguments.
- `checks`: each check has a `label` and an `anyOf` list. A check passes when any matcher matches. `not: true` inverts it. A matcher has one of `bb` (a `bb` call, with its stdin), `command` (a shell command), `tool` (a tool call as `name {json input}`, for example `^mcp__bb-bridge__bb_workflow_run `), `skill` (a skill name), `text` (any assistant text), or `final` (the last answer). `times` asks for an exact count.

Add a case before you change the text. Run it on the old text, and with `--without-bb-text`. Then change the text and run it again.

Use no user data in cases. Use names such as `thr_peer42` and `/home/user`.
