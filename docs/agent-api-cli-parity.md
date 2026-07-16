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

Thread creation and messaging also support structured path attachments:

```text
bb thread spawn ... --file <path> --image <path>
bb thread tell <id> <message> --file <path> --image <path>
```

Both attachment flags are repeatable. `thread spawn` additionally supports
`--folder <id>`, `--origin-kind fork|side-chat`, `--source-thread <id>`, and
`--source-seq-end <seq>`. It also accepts `--visibility visible|hidden`; hidden
threads remain directly addressable but cannot be combined with `--folder` and
are omitted from ordinary organization, project prompt history, parent
lifecycle, search, attention, and native child-completion surfaces. The SDK
accepts the equivalent `input`, `folderId`, `originKind`, `sourceThreadId`,
`sourceSeqEnd`, and `visibility` fields, with the same hidden-plus-folder
rejection. Explicit app debugging is available through
`bb.threads.open({ threadId, debugHidden: true, file: null })` and
`bb thread open <thread-id> --debug-hidden`.

`--file` and `--image` do not read paths on the CLI machine. Absolute paths are
passed through for the thread execution host to read; relative values are
server-managed project attachment paths returned by the upload API.

## Projects

| SDK                                               | CLI                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `bb.projects.create({ name, source })`            | `bb project create --name <name> --root <path> [--machine/--host <id-or-name>]`                                  |
| `bb.projects.promptHistory({ projectId, limit })` | `bb project history <id> [--limit <count>]`                                                                      |
| `bb.projects.reorder(...)`                        | `bb project reorder <id> [--after <id>] [--before <id>]`                                                         |
| `bb.projects.branches(...)`                       | `bb project branches <id> --host <id> [--query <query>] [--limit <count>]`                                       |
| `bb.projects.paths(...)`                          | `bb project paths <id> [--machine/--host <id-or-name> / --environment <id>] [--query <query>] [--limit <count>]` |
| `bb.projects.files(...)`                          | `bb project files <id> [--machine/--host <id-or-name> / --environment <id>] [--query <query>] [--limit <count>]` |
| `bb.projects.fileContent(...)`                    | `bb project content <id> <path> [--machine/--host <id-or-name> / --environment <id>]`                            |
| `bb.projects.commands(...)`                       | `bb project commands <id> --provider <id> [--machine/--host <id-or-name> / --environment <id>]`                  |
| `bb.projects.defaultExecutionOptions(...)`        | Available through the SDK; existing CLI execution flags consume these defaults.                                  |
| `bb.projects.attachments.upload(...)`             | `bb project attachment upload <id> --client-file <path> [--filename <name>] [--mime-type <type>]`                |
| `bb.projects.attachments.read(...)`               | `bb project attachment download <id> <attachment-path> --client-file <path>`                                     |

Existing project source operations remain available under
`bb.projects.sources` and `bb project source`.

Project creation already has explicit host parity in the SDK contract: its
local-path `source` requires `hostId`. The CLI resolves an explicit connected
machine ID or unambiguous name into that field; without a selector it preserves
the existing local CLI machine fallback (normally the primary machine).

Project workspace host and environment selectors are mutually exclusive. An
environment selects its owning host and workspace; otherwise an explicit host
selects that host's project source. Omitting both intentionally falls back to
the primary host's project source. File content uses UTF-8 for text and base64
for binary data in the portable SDK/CLI JSON DTO.

Project attachment upload is the client-local byte path: the SDK accepts
`Uint8Array`, `ArrayBuffer`, `Blob`, and File-like input and sends multipart
data to the selected server. The CLI reads `--client-file` on the CLI machine,
so it works when that machine is different from both the server and thread
execution host. The result is the existing uploaded-attachment DTO; image MIME
types are limited to 10MB and other uploads to 25MB. The server currently has
no attachment list or per-attachment remove operation, so neither surface
invents one.

## Environments and pull requests

Every direct inspection command accepts an arbitrary environment ID; none
requires a thread.

| SDK                                                           | CLI                                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bb.environments.get({ environmentId })`                      | `bb environment show <id>`                                                                          |
| `bb.environments.update(...)`                                 | `bb environment update <id> [metadata flags]`                                                       |
| `bb.environments.status(...)`                                 | `bb environment status <id> [--merge-base-branch <branch>]`                                         |
| `bb.environments.diffBranches(...)`                           | `bb environment branches <id> [--query <query>] [--limit <count>]`                                  |
| `bb.environments.paths(...)`                                  | `bb environment paths <id> [--query <query>] [--limit <count>] [--files] [--directories]`           |
| `bb.environments.diff(...)`                                   | `bb environment diff <id> --target <target> [--merge-base-branch <branch> / --sha <sha>]`           |
| `bb.environments.diffFiles(...)`                              | `bb environment diff-files <id> --target <target> [--merge-base-branch <branch> / --sha <sha>]`     |
| `bb.environments.diffFile(...)`                               | `bb environment diff-file <id> --target <target> --path <path> --side <old/new> [target ref flags]` |
| `bb.environments.diffPatch(...)`                              | `bb environment diff-patch <id> --target <target> --path <path>... [--merge-base-branch / --sha]`   |
| `bb.environments.pullRequest({ environmentId })`              | `bb environment pull-request show <id>`                                                             |
| `bb.environments.commit({ environmentId })`                   | `bb environment commit <id>`                                                                        |
| `bb.environments.squashMerge(...)`                            | `bb environment squash-merge <id> --merge-base-branch <branch>`                                     |
| `bb.environments.archiveThreads({ environmentId })`           | `bb environment archive-threads <id>`                                                               |
| `bb.environments.markPullRequestReady({ environmentId })`     | `bb environment pull-request ready <id>`                                                            |
| `bb.environments.markPullRequestDraft({ environmentId })`     | `bb environment pull-request draft <id>`                                                            |
| `bb.environments.mergePullRequest({ environmentId, method })` | `bb environment pull-request merge <id> [--method <merge/squash/rebase>]`                           |

Diff targets are `uncommitted`, `branch_committed`, `all`, and `commit`.
Branch targets require `--merge-base-branch`, commit targets require `--sha`,
and `diff-file` uses the resolved `--merge-base-ref` for branch targets.

## Providers

| SDK                                                              | CLI                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bb.providers.list({ hostId? / environmentId? })`                | `bb provider list [--machine <id-or-name> / --host <id-or-name> / --environment <id>]`                |
| `bb.providers.models({ providerId?, hostId? / environmentId? })` | `bb provider models [providerId] [--machine <id-or-name> / --host <id-or-name> / --environment <id>]` |

Host and environment selectors are mutually exclusive. An environment resolves
to its owning host; otherwise an explicit host is used. Omitting both selectors
intentionally falls back to the primary machine.

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

## Appearance

The canonical appearance input is the complete `{ themeId, faviconColor }`
selection. `bb.theme.set(selection)` sends it atomically. The compatible
`bb.theme.set(themeId)` shorthand reads the active appearance first and carries
its favicon color forward.

| SDK                                       | CLI                                                              |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `bb.theme.get()`                          | `bb theme show`                                                  |
| `bb.theme.catalog()`                      | `bb theme list`                                                  |
| `bb.theme.set({ themeId, faviconColor })` | `bb theme set <id> --favicon-color <color>`                      |
| `bb.theme.set(themeId)`                   | `bb theme set <id>` or `bb theme reset`; preserves favicon color |
| Read current, then `set({ ... })`         | `bb theme favicon set <color>` or `reset`; preserves theme       |

Valid favicon colors are `default`, `red`, `orange`, `yellow`, `green`, `teal`,
`blue`, `purple`, and `pink`. Invalid values are rejected before the CLI sends a
write and by the shared server request schema.

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
bb.plugins.catalog.install({ entryId })
bb.plugins.getSource({ pluginId })
bb.plugins.checkUpdates({ pluginId })
bb.plugins.listUpdateResults()
bb.plugins.applyUpdate({ pluginId })
bb.plugins.reload({ pluginId })
bb.plugins.enable({ pluginId })
bb.plugins.disable({ pluginId })
bb.plugins.remove({ pluginId })
bb.plugins.getSettings({ pluginId })
bb.plugins.updateSettings({ pluginId, values })
bb.plugins.token({ pluginId, rotate })
bb.plugins.catalog.status()
bb.plugins.catalog.search({ query })
```

Direct and catalog installs are separate methods so source strings and catalog
entry ids cannot be confused. Catalog installs resolve to the official plugin
bundled with the app; callers that need a different npm version use a direct
`npm:` install.
These administration methods are available to backend plugins via the complete
`bb.sdk`; they are intentionally absent from the restricted
`@bb/plugin-sdk/app` frontend contract.

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
