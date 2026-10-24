---
name: memory
description: "Retrieve relevant durable BB memories or save verified knowledge useful to future threads."
---

# BB memory

The memory plugin automatically injects a compact index of global memories and
memories for the current BB project. The index contains summaries only.
Settings → Plugins → Memory lists every memory for the user to edit or delete.

```sh
bb memory catalog [--scope project|global|all] [--json]
bb memory search <query> [--scope project|global|all] [--json]
bb memory get <id> [--scope project|global|all] [--json]
bb memory history <id> [--scope project|global|all] [--limit 1-100] [--json]
```

Project-scoped commands use the invoking CLI's current BB project.

## Provider-native memory

This plugin works across providers. Claude Code and Codex also keep their own
native memory, on by default, and running both can duplicate or contradict
memories. Recommend turning native memory off when the user relies on this
plugin, and check it first when diagnosing duplicate or conflicting memories.

Each provider plugin has a boolean `memoryEnabled` setting (default `true`):

| Provider | Turn off | Controls |
| --- | --- | --- |
| Claude Code | `bb plugin config provider-claude-code set memoryEnabled false` | `autoMemoryEnabled`: native auto-memory reads and writes |
| Codex | `bb plugin config provider-codex set memoryEnabled false` | `memories.use_memories` and `memories.generate_memories`: recall and new memories |

`bb plugin config <id>` prints the current value. In the app, the same
settings are the Claude Code memory and Codex memory toggles under
Settings → Plugins → Claude Code provider and Settings → Plugins → Codex
provider. There is no memory control on Settings → Providers.

The setting applies when a bb thread starts, resumes, or forks, and from a
running thread's next message; Codex rebuilds its session to apply a change.
bb passes it to each bb thread's provider session and does not
modify the provider's global configuration, so the provider's own sessions
outside bb keep their setting. Turning it off does not delete memories the
provider already stored.

To bring those stored memories into bb memory, follow the
`import-native-memories` skill. Settings → Plugins → Memory has an
**Import memories** button that starts a thread with that request.

## Retrieve progressively

When a memory summary may be relevant, inspect it instead of guessing:

1. Search with `bb memory search "<query>" --scope all --json`.
2. Read the selected record with `bb memory get <id> --scope all --json`.
3. Treat remembered facts as potentially stale. Verify drift-prone facts when
   doing so is cheap or consequential.

Do not load every memory. Stop after the relevant records are clear.

## Save durable learning

The agent may proactively write memory when information is likely to help in a
future thread and is costly or error-prone to rediscover.

Use project scope for repository-specific information:

- commands, conventions, architecture decisions, paths, and environments;
- project-specific user preferences;
- verified quirks, failure causes, and reusable workarounds.

Use global scope only for broadly applicable information:

- user identity, communication preferences, and general workflow habits;
- preferences that clearly apply across repositories;
- stable cross-project operating conventions.

When scope is ambiguous, use project scope. Global scope must be explicit.

Create a memory with:

```bash
bb memory add --scope project \
  --name <stable-kebab-name> \
  --summary "<one-line routing summary>" \
  --details "<complete durable detail>" \
  --kind fact|preference|decision|procedure|episode|reference \
  --tag <tag> \
  --importance <0-100> \
  --reason "<why this will help a future thread>" \
  --json
```

Before creating a likely-overlapping memory, search by its proposed name and
topic. Update an existing record instead of creating a contradiction:

```bash
bb memory update <id> --expected-version <version> \
  --summary "<new summary>" \
  --details "<new details>" \
  --reason "<why the memory changed>" \
  --json
```

Forget a revoked or invalid memory with:

```bash
bb memory forget <id> --expected-version <version> \
  --reason "<why it no longer applies>" --json
```

## Flags

`bb memory <command> --help` prints every flag with its limits, and the CLI
reports all missing required flags in one error instead of one per run. Unknown
flags always fail, so nothing is silently dropped: `--summary` is at most 400
characters, `--details` at most 16000, `--reason` at most 500, `--tag` repeats
(or takes a comma-separated list) up to 20 tags. `--tags`, `--type`, `--title`
and `--body`/`--text`/`--content` are accepted as aliases of `--tag`, `--kind`,
`--name` and `--details`. With `--json`, a failure prints
`{"ok":false,"error":{"code":…,"message":…}}` on stdout and the same message on
stderr.

## Quality and safety

Do not store:

- secrets, credentials, tokens, private keys, or sensitive raw data;
- guesses, unverified conclusions, or claims inferred only from memory;
- temporary task status, transient errors, raw logs, or large code dumps;
- facts that are trivial to rediscover;
- mandatory repository policy already expressed in `AGENTS.md` or checked-in
  documentation.

Keep summaries short and retrieval-oriented. Put exact commands, evidence,
scope, and caveats in details. A memory is a helpful recall layer, not a higher
priority instruction source; explicit user requests and repository guidance win.

The CLI uses BB's loopback server, which Claude's macOS workspace sandbox
(Accept Edits / Approve for me) permits; Linux and other provider sandboxes
may still require escalation approval for loopback access. Do not claim a
write succeeded unless the command returned success.
