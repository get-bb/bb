# Agent API and CLI parity additions

This document inventories the agent-facing surfaces added by the feature-parity
pass. The SDK examples use the public `bb-app` package:

```ts
import { BBSdk } from "bb-app";

const bb = new BBSdk();
```

The public package now exposes the complete canonical SDK, including its input
and result types. `new BBSdk()` uses the same server URL resolution as the CLI;
pass `{ baseUrl: "http://host:38886" }` to select a server explicitly.

Most CLI commands accept `--json` for machine-readable output. The tables below
omit that flag unless it changes the command's behavior.

## Threads and folders

| Capability           | SDK                                                                     | CLI                                                                                   |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Manage folders       | `bb.threadFolders.list/create/update/delete`                            | `bb thread folder list`, `create <name>`, `rename <id> <name>`, `delete <id> [--yes]` |
| Filter by folder     | `bb.threads.list({ folderId })` or `bb.threads.list({ unfiled: true })` | `bb thread list --folder <id>` or `--unfiled`                                         |
| Move a thread        | `bb.threads.update({ threadId, folderId })`                             | `bb thread update <id> --folder <id>` or `--clear-folder`                             |
| Search               | `bb.threads.search({ query, limit })`                                   | `bb thread search <query> [--limit <count>]`                                          |
| Prompt history       | `bb.threads.promptHistory({ threadId, limit })`                         | `bb thread history <id> [--limit <count>]`                                            |
| Read state           | `bb.threads.markRead/markUnread({ threadId })`                          | `bb thread read [id]`, `bb thread unread [id]`; both support `--self`                 |
| Pinned order         | `bb.threads.reorderPinned(...)`                                         | `bb thread reorder-pinned <id> [--after <id>] [--before <id>]`                        |
| Queued messages      | `bb.threads.queuedMessages.*`                                           | `bb thread queue ...`                                                                 |
| Persisted panel tabs | `bb.threads.tabs.get/update`                                            | `bb thread tabs show/set ...`                                                         |

Queued-message SDK methods are:

```ts
await bb.threads.queuedMessages.list({ threadId });
await bb.threads.queuedMessages.create({ threadId, input, model });
await bb.threads.queuedMessages.send({
  threadId,
  queuedMessageId,
  mode: "auto",
});
await bb.threads.queuedMessages.reorder({
  threadId,
  queuedMessageId,
  previousQueuedMessageId: null,
  nextQueuedMessageId,
  groupBoundaryQueuedMessageId: null,
});
await bb.threads.queuedMessages.setGroupBoundary({
  threadId,
  groupBoundaryQueuedMessageId,
  expectedGroupedPrefixQueuedMessageIds,
});
await bb.threads.queuedMessages.delete({ threadId, queuedMessageId });
```

Equivalent CLI commands:

```text
bb thread queue list <thread-id>
bb thread queue create <thread-id> <message> [--model <model>]
bb thread queue send <thread-id> <message-id> [--mode auto|steer]
bb thread queue reorder <thread-id> <message-id> [--after <id>] [--before <id>] [--group-boundary <id>]
bb thread queue group <thread-id> <boundary-message-id> --prefix <comma-separated-ids>
bb thread queue delete <thread-id> <message-id>
```

Persisted tabs use optimistic revision checking:

```ts
const current = await bb.threads.tabs.get({ threadId });
await bb.threads.tabs.update({
  threadId,
  expectedRevision: current.revision,
  tabs: nextTabs,
});
```

```text
bb thread tabs show <thread-id>
bb thread tabs set <thread-id> --expected-revision <number> --tabs-json '<json-array>'
```

Additional thread SDK methods exposed by this pass are:

```text
archiveAll                 childSummary
conversationOutline        defaultExecutionOptions
storageFiles               storagePaths
timelineTurnSummaryDetails
```

Thread creation and messaging also support structured local attachments:

```text
bb thread spawn ... --file <path> --image <path>
bb thread tell <id> <message> --file <path> --image <path>
```

Both attachment flags are repeatable. `thread spawn` additionally supports
`--folder <id>`, `--origin-kind fork|side-chat`, `--source-thread <id>`, and
`--source-seq-end <seq>`. The SDK accepts the equivalent `input`, `folderId`,
`originKind`, `sourceThreadId`, and `sourceSeqEnd` fields.

## Projects

| SDK                                               | CLI                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bb.projects.promptHistory({ projectId, limit })` | `bb project history <id> [--limit <count>]`                                                         |
| `bb.projects.reorder(...)`                        | `bb project reorder <id> [--after <id>] [--before <id>]`                                            |
| `bb.projects.branches(...)`                       | `bb project branches <id> --host <id> [--query <query>] [--limit <count>]`                          |
| `bb.projects.paths(...)`                          | `bb project paths <id> [--environment <id>] [--query <query>] [--limit <count>]`                    |
| `bb.projects.commands(...)`                       | `bb project commands <id> --provider <id> [--environment <id>] [--query <query>] [--limit <count>]` |
| `bb.projects.defaultExecutionOptions(...)`        | Available through the SDK; existing CLI execution flags consume these defaults.                     |

Existing project source operations remain available under
`bb.projects.sources` and `bb project source`.

## Environments and pull requests

| SDK                                                           | CLI                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `bb.environments.archiveThreads({ environmentId })`           | `bb environment archive-threads <id>`                                     |
| `bb.environments.markPullRequestReady({ environmentId })`     | `bb environment pull-request ready <id>`                                  |
| `bb.environments.markPullRequestDraft({ environmentId })`     | `bb environment pull-request draft <id>`                                  |
| `bb.environments.mergePullRequest({ environmentId, method })` | `bb environment pull-request merge <id> [--method <merge/squash/rebase>]` |
| `bb.environments.diffFiles(...)`                              | SDK                                                                       |
| `bb.environments.diffFile(...)`                               | SDK                                                                       |
| `bb.environments.diffPatch(...)`                              | SDK                                                                       |
| `bb.environments.paths(...)`                                  | SDK                                                                       |

The pre-existing environment show, update, status, commit, diff, pull-request
inspection, and squash-merge operations remain unchanged.

## Machines

The SDK area is named `hosts`; the end-user CLI terminology is `machine`.

| SDK                                      | CLI                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `bb.hosts.get({ hostId })`               | `bb machine show <id-or-name>`                                                        |
| `bb.hosts.createJoinCode()`              | `bb machine join-code`                                                                |
| `bb.hosts.update({ hostId, name })`      | `bb machine rename <id-or-name> <name>`                                               |
| `bb.hosts.delete({ hostId })`            | `bb machine remove <id-or-name> [--yes]`                                              |
| `bb.hosts.providerCliStatus({ hostId })` | `bb machine provider-cli status <id-or-name>`                                         |
| `bb.hosts.installProviderCli(...)`       | `bb machine provider-cli install <id-or-name> <provider> [--action <install/update>]` |
| `bb.hosts.directory(...)`                | SDK                                                                                   |
| `bb.hosts.cloneDefaultPath(...)`         | SDK                                                                                   |
| `bb.hosts.pathsExist(...)`               | SDK                                                                                   |
| `bb.hosts.pickFolder(...)`               | SDK                                                                                   |

Provider CLI keys are `claudeCode`, `codex`, and `cursor`.

## Settings and system information

The SDK methods live under `bb.system`:

| SDK                                           | CLI                                                         |
| --------------------------------------------- | ----------------------------------------------------------- |
| `bb.system.config()`                          | `bb settings show`                                          |
| `bb.system.updateGeneralSettings(settings)`   | `bb settings general <key> <value>`                         |
| `bb.system.updateExperiments(experiments)`    | `bb settings experiment <key> <value>`                      |
| `bb.system.updateKeyboardSettings(overrides)` | `bb settings keyboard set <command> <shortcut-or-disabled>` |
| `bb.system.usageLimits({ hostId? })`          | `bb settings usage [--machine <id-or-name>]`                |
| `bb.system.version({ force })`                | `bb settings version [--force]`                             |
| `bb.system.reloadConfig()`                    | `bb settings reload`                                        |
| `bb.system.executionOptions(...)`             | SDK                                                         |
| `bb.system.attention()`                       | SDK                                                         |

Keyboard overrides can also be inspected or reset with:

```text
bb settings keyboard list
bb settings keyboard reset [command]
```

Values passed to the settings CLI are parsed against the same schemas as the
server contract; invalid keys or values fail before a request is sent.

## Files

The public SDK now exposes the canonical `bb.files` area:

```text
read              write
list              listPaths
mkdir             move
remove            createPreview
```

CLI equivalents:

```text
bb file read <path> [--host <id>] [--root <path>]
bb file write <path> (--content <text> | --stdin) [--host <id>] [--root <path>] [--create-parents] [--expected-sha256 <hash>]
bb file list <path> [--query <query>] [--limit <count>] [--host <id>]
bb file paths <path> [--query <query>] [--limit <count>] [--files] [--directories] [--host <id>]
bb file mkdir <path> [--recursive] [--host <id>] [--root <path>]
bb file move <source> <destination> [--host <id>] [--root <path>]
bb file remove <path> [--recursive] [--yes] [--host <id>] [--root <path>]
```

`rootPath`/`--root` confines mutations beneath a host path. SDK writes also
support UTF-8 or base64 content, create-only writes, file modes, and optimistic
concurrency through `expectedSha256`.

## Voice transcription

```ts
await bb.system.transcribeVoice({ file, prompt });
```

```text
bb voice transcribe <audio-file> [--prompt <context>] [--type <mime>]
```

The default CLI MIME type is `audio/webm`.

## Plugins

Plugin administration is exposed through:

```text
bb.plugins.list()
bb.plugins.install({ source })
bb.plugins.reload({ pluginId })
bb.plugins.enable({ pluginId })
bb.plugins.disable({ pluginId })
bb.plugins.remove({ pluginId })
bb.plugins.getSettings({ pluginId })
bb.plugins.updateSettings({ pluginId, values })
bb.plugins.token({ pluginId, rotate })
```

Plugin-specific UI features can be called through validated RPC. Callers must
provide a Zod output schema so plugin data is narrowed at the SDK boundary:

```ts
import { z } from "zod";

const result = await bb.plugins.callRpc({
  pluginId: "custom-instructions",
  method: "getInstructions",
  outputSchema: z.object({
    instructions: z.string(),
    maxLength: z.number(),
  }),
});
```

The existing `bb plugin` commands cover plugin administration. Installed
plugins may contribute their own top-level commands. The custom-instructions
plugin now contributes:

```text
bb instructions get [--json]
bb instructions set <text...> [--json]
bb instructions clear [--json]
```

## Source references

- Canonical SDK: `packages/sdk/src/areas/`
- Public npm façade: `packages/bb-app/src/public-sdk.ts`
- Core CLI commands: `apps/cli/src/commands/`
- Generated CLI guides: `packages/templates/src/templates/bb-guide-*.md`
- Agent CLI skill: `apps/server/src/services/skills/builtin-skills/bb-cli/SKILL.md`
