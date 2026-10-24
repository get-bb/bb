# bb-plugin-memory

BB's official plugin for durable, progressively disclosed agent memory. It
provides:

- plugin-private SQLite storage with append-only migrations;
- global and current-project memory scopes;
- an automatically injected, 3,900-character summary catalog through
  `bb.agents.contributeInstructions`;
- CLI-only agent access through `bb memory` (no native agent tools);
- FTS5 search followed by full-record reads;
- explicit provenance, tags, kinds, importance, pinning, and version history;
- optimistic update/forget operations and soft deletion;
- basic prompt-injection and secret-pattern rejection;
- a bundled `memory` skill that teaches agents retrieval and write policy;
- a bundled `import-native-memories` skill that moves Claude Code and Codex
  memories into this store after you approve the plan;
- a Settings → Plugins → Memory table for reviewing, editing, and deleting
  every stored global or project memory.

## Install

Install Memory from the BB Official catalog:

```bash
bb plugin install memory
bb plugin list
```

## Try it

```bash
bb memory add \
  --scope project \
  --name turbo-validation \
  --summary "Use Turbo for builds and typechecks" \
  --details "Run pnpm exec turbo run typecheck --filter=@bb/<pkg>." \
  --kind procedure \
  --tag build \
  --tag testing \
  --importance 80 \
  --reason "Durable repository validation convention" \
  --json

bb memory search "Turbo typecheck" --scope all --json
bb memory get <id> --scope all --json
```

## Provider-native memory

Claude Code and Codex keep their own memory, on by default. Turn it off while
using this plugin so memories aren't duplicated or split between stores:

```bash
bb plugin config provider-claude-code set memoryEnabled false
bb plugin config provider-codex set memoryEnabled false
```

The same switches are the Claude Code memory and Codex memory toggles under
Settings → Plugins → Claude Code provider and Codex provider. The bundled
[`memory` skill](skills/memory/SKILL.md#provider-native-memory) explains what
each setting controls and when it applies.

To keep what your agents already remember, click **Import memories** in
Settings → Plugins → Memory. It opens a new thread with the request filled in.
The card shows only when an enabled provider's plugin defines a
`memoryEnabled` setting. The bundled
[`import-native-memories`](skills/import-native-memories/SKILL.md) skill has
the agent find those memories on every connected machine, propose what to
keep, and save only after you approve. It only reads the provider files.

## Scopes

Project writes take the invoking CLI's BB project context. Global writes must
explicitly pass `--scope global`. The injected catalog refreshes at every
thread start / turn submission, so a successful CLI write is visible on the
next turn.

## Limitations

- CLI calls require loopback access to the local server. Claude's macOS
  workspace sandbox permits this; Linux and other provider sandboxes may
  still block it.
- Retrieval is FTS5 keyword search in this first version; embeddings and
  background reflection are deliberately deferred.
- The safety scanner is a guardrail, not a substitute for avoiding sensitive
  memory content.

## Develop

```bash
pnpm exec turbo run test typecheck --filter=bb-plugin-memory
bb plugin dev ./plugins/memory
```
