# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "CLI And Plugin API"). Each entry
summarizes the API, names where its behavior is documented, and lists what
must be settled before the prefix drops. Stabilizing means auditing the entry,
renaming project-wide, and deleting the entry in the same change. An entry
that stays experimental after an audit says so with the date and the open
question.

"Docs:" names a file in
`plugins/bb-guide/skills/bb-plugin-authoring/references/`, or
[provider-plugin-api.md](provider-plugin-api.md) /
[provider-bridge-protocol.md](provider-bridge-protocol.md). An entry without
a "Docs:" line has no owning doc, so it keeps the essential contract itself.

## Composer popups

`ComposerCustomization.experimental_popups` registers `{ id, label, component }`
popups; `PluginComposerApi.experimental_openPopup(id)` opens one in that
composer and `experimental_closePopup()` closes it, both returning false when
they cannot act.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, verify multiple composers, selection retention, plugin
reload and crash recovery, scope suppression, and compact Safari
keyboard/drawer behavior. Verify multiple popups in one customization and
popup-id uniqueness across customizations.

## Composer commands

`PluginAppComposer.experimental_registerCommand({ id, title, defaultShortcut?, run })`
registers a palette and keyboard command that runs against the owning
composer's `PluginComposerApi`, rebindable under
`plugin:<plugin-id>/<command-id>` and sharing the `app.commands` id namespace.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, verify split panes, side chat, inline queued-message
editing, palette invocation from each, plugin reload, and rebinding. Audit
whether composer scopes should filter commands the way they filter other
composer contributions, and whether commands need an availability callback.

## `settingsSection.experimental_page`

`experimental_page: "mobile"` mounts a plugin settings section only on
Settings → Mobile, and only when that plugin owns the selected access
provider. Omitting it keeps the section on the plugin's configuration page.

Stabilization requires verifying placement isolation, plugin
disable/uninstall, loading and failure states, and pairing lifecycle on
Mobile.

## `app.commands.register`

Unprefixed by explicit request. Registers frontend commands
(`{ id, title, defaultShortcut?, isAvailable?, run }`) for the quick palette
and keyboard bindings; the deprecated `app.slots.commandPaletteAction` alias
shares its validation and per-plugin id namespace.

Docs: `frontend-renderer-slots.md`.

Audit command identity, availability outside the palette, shortcut conflicts,
and saved binding lifecycle before stabilizing the keyboard shortcut
contract. Audit cross-platform conflicts and plugin lifecycle before
extending the context model or default binding policy.

## Discoverable RPC

`bb.rpc.register` accepts `experimental_discoverable` and
`experimental_description` options, and method definitions accept
`experimental_description`. A discoverable method publishes its wire schemas
(Standard JSON Schema) and description. Discovery does not change RPC
authorization or dispatch. `bb.sdk.plugins.experimental_discoverRpc({ pluginId?, method? })`
lists the published methods of loaded plugins. Methods disappear on unload, so
callers handle the race between discovery and invocation. The fake host
exposes `experimental_publishedRpcMethods`.

Before stabilization, audit schema export fidelity (especially refinements and
transforms), descriptor size and reference limits, lifecycle races, and
cross-plugin copied-schema compatibility. Verify `bb plugin rpc list|inspect`
is sufficient to implement a consumer without a shared contract package.
Method names carry optional versions; there is no negotiation.

## Plugin safe mode

`bb.sdk.plugins.experimental_getSafeMode()` returns `{ enabled }`.
`experimental_setSafeMode({ enabled })` returns `{ enabled, problems }`, where
`problems` names each plugin that did not start when safe mode ended. While
safe mode is on, only plugins included with bb run: `builtin` provenance, or
an auto-installed bundled source. Every other plugin stays unloaded with
status `disabled`. Each plugin's own `enabled` flag is untouched. Enable keeps
an affected plugin unloaded, reload reports a failure, and install and update
are refused. The flag persists on the server and backs
`bb plugin safe-mode [on|off]`.

Before stabilization, audit whether official store plugins should count as
included, whether a plugin calling `experimental_setSafeMode` should be
allowed to stop itself and others, whether the toggle should run
asynchronously for installs with many slow plugins, and whether startup needs
an out-of-band override (env var or flag) for a plugin that breaks the server
before the toggle is reachable.

## RPC caller identity (`ExperimentalPluginRpcHandlerContext.experimental_caller`)

Every `bb.rpc.register` handler receives a context whose `experimental_caller`
is `{ kind: "plugin", pluginId }` for a loaded plugin's
`bb.sdk.plugins.callRpc` and `{ kind: "client" }` for everyone else. A
per-load token makes the identity unforgeable by clients.

Docs: `backend-events.md`, `backend-sdk.md`.

Before stabilizing, audit whether other surfaces (HTTP routes, agent tools,
CLI commands) need the same identity, whether a plugin needs to know the
calling app window or thread, and whether in-process plugins that read other
plugins' memory make the token a meaningful boundary for third-party plugins.
bb account relies on it to keep `/api/connect/` requests, credential reads,
refused-credential reports, and credential adoption to the connect plugin.

## `bb.http.experimental_websocket`

Registers an exact-path WebSocket upgrade in the plugin's
`/api/v1/plugins/<id>/http/` namespace. It shares HTTP route auth modes.
Sockets from a replaced or disabled plugin generation close with code 1012.
The test harness drives it with `experimental_openWebSocket`.

Docs: `backend-events.md`, `testing.md`.

**Audit before stabilizing.**

1. Confirm the HTTP namespace and exact-path rule cover plugin proxy use cases
   without a separate WebSocket namespace or parameterized routing.
2. Decide whether subprotocol negotiation belongs in the context or returned
   handler contract.
3. Confirm string and `Uint8Array` are sufficient for frame data and sends.
4. Confirm code 1012 is the right reload/disable signal and whether plugins
   need a distinct disposal reason.
5. Confirm the callback error policy should keep the socket open after an
   isolated message-handler failure.

## `bb.providers.experimental_contributeEnvHealth`

Registers one host-scoped readiness resolver beside a provider environment
contribution. When the bridge reports `unauthenticated` or `expired`, a
non-null answer presents the provider as ready with its label and status
message.

Docs: `providers.md`.

**Audit before stabilizing.**

1. Confirm readiness should override only `unauthenticated` and `expired`, not
   installation or unknown failures.
2. Decide whether the contribution should report account identity or usage in
   addition to a label and status message.
3. Confirm the first available resolver in plugin load order is the right
   arbitration when several credential proxies target one provider.
4. Confirm a five-second timeout is appropriate for host-scoped credential
   availability checks.

## `bb.providers.experimental_contributeEnv`

Registers one resolver per provider per plugin that returns up to 32
environment entries for each session and turn. Each entry is a literal or a
server-relative path the host expands. Conflicts resolve in plugin load
order, and the values override the shell environment.

Docs: `providers.md`.

**Audit before stabilizing.**

1. Confirm one resolver per provider is sufficient when plugins need multiple
   independently disposable features.
2. Confirm plugin load order is the right deterministic conflict policy.
3. Confirm the 32-entry cap and five-second timeout fit providers that resolve
   short-lived credentials.
4. Decide whether `serverPath` needs structured query parameters or non-HTTP
   server endpoints before accepting more shapes.
5. Confirm `reason` should remain required and whether event consumers need a
   stable machine-readable purpose beside it.
6. Decide whether the context and entry types should stabilize with the method
   or remain experimental for a longer compatibility window.

## Compatibility windows

Open windows left by the SDK 0.4.16 stabilization renames. The bb-app
CHANGELOG records the renames themselves.

- Renamed declaration, tool and navPanel fields (`experimental_strings`,
  `experimental_presentation`, `experimental_fixedTabs`, …) are rejected at
  registration with a message naming the new field.
- Presentation-less `toolCall` rows pass through the legacy-data adapter
  (`upgradeLegacyToolItem` in `@bb/domain`). It renders Read/Grep/Glob and
  read/grep/find/ls as `fileRead`/`search` rows and suppresses
  Task*/Todo*/ToolSearch bookkeeping calls. The pi bridge's live generic
  `tool` rows still take this path. To close the window, pi stamps
  `fileRead`/`search` presentation, the `legacy-tool-item-backfill` migration
  stamps old rows, and `presentation` becomes required on
  `item.open`/`item.close`. Then the adapter and its tests are deleted.

## Scheduled removals (next major)

Unprefixed exports of `@get-bb/plugin-sdk/provider-bridge` with no consumer in
this repository. They stay because a third-party bridge compiled against an
SDK before 0.4.16 may import them, and dropping a published name is a
breaking change. Remove them at the next major version. The
`provider-bridge-scheduled-removals` SDK test holds the facade to this list.

Re-exported from `@bb/domain`, where each still has core consumers:

- `acpNativeReasoningSchema`
- `acpPermissionCliSchema`
- `acpReasoningCliSchema`
- `extensionKindSchema`
- `interactionRequestPayloadSchema`
- `isExtensionKind`
- `isUserQuestionPendingInteractionPayload`
- `isUserQuestionPendingInteractionResolution`
- `providerRecoveryKindValues`
- `threadEventItemPresentationSchema`
- `threadEventSearchModeSchema`

Aliases of moved definitions. The ACP pair aliases the ACP kit's
`experimental_acpLaunchSpecSchema` / `AcpLaunchSpec` and normalizer
(`@get-bb/plugin-sdk/provider-bridge/acp`). The task-tool pair has no
replacement.

- `hostDaemonAcpLaunchSpecSchema`
- `normalizeHostDaemonAcpLaunchSpec`
- `claudeTaskToolNameSchema`
- `claudeTaskToolOutputSchema`
- `HostDaemonAcpLaunchSpec`
- `ClaudeTaskToolOutput`

Also kept only until the next major:

- On `@get-bb/plugin-sdk/provider-bridge/acp`, `AcpAgentProfile`, a deprecated
  alias of `AcpLaunchSpec`.
- On `@get-bb/plugin-sdk/provider-bridge/testing`,
  `CONFORMANCE_ASSEMBLED_EVENT_METHOD`. The conformance kit assembles
  `thread/delta` itself and reads nothing under that method.
- The `disallowedTools` field of `threadStartParamsSchema`,
  `threadResumeParamsSchema` and `threadForkParamsSchema`. The runtime never
  populates it.

## Settings schemas and server writes

`PluginSettingDescriptor.experimental_schema` is a synchronous,
non-transforming Standard Schema validator. The server runs it on every
proposed value. `PluginSettingsHandle.experimental_set` validates and persists
the plugin's own fields, like a settings route or `bb plugin config` write.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

- Confirm synchronous, non-transforming validation remains sufficient.
- Decide whether settings errors need structured issue paths in addition to
  the first user-facing message.
- Confirm schemas should continue running for defaults at registration.
- Exercise concurrent route, CLI, and plugin-owned writes, including secret
  values and unsets, before stabilizing `experimental_set`.
- Decide whether schemas and server-side writes stabilize independently.

## `PluginSettingDescriptor` type `"number"`

A numeric setting descriptor stores a finite `number`, renders a number
input, converts CLI values, and reads legacy numeric strings as numbers.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

- Decide whether common minimum, maximum, and step metadata belongs directly
  on the descriptor instead of only in `experimental_schema`.
- Confirm clearing a number input should continue to unset the stored value.
- Decide how long legacy stored numeric strings should be coerced on read.
- Exercise decimal and exponent input across browser engines and the CLI.

## `bb.experimental_hooks` (`on`, `recheck`)

`on("message.dispatch", handler)` answers core's admission checkpoint before
every message reaches a provider. A handler returns `proceed`, `wait` (queue
the message with a reason and optional `sendAt`), or `reject` (409).
Handlers run as a fail-closed chain in install order under one server-wide
lock. `recheck("message.dispatch")` schedules a re-attempt of every
plugin-queued row and resolves when the walk is scheduled.

Docs: `backend-events.md`.

**Audit before stabilizing.**

- **Grouped dispatch authors.** `initiator`, `senderThreadId`, `origin` and
  `originPluginId` summarize every row in `queuedMessages`, and report
  `mixed` when the rows disagree. Verify plugins handle mixed origins
  independently of authors.
- **`queuedMessage` is emitted but untyped.** Core still emits the first
  queued row or null under the old name for previously built handlers. Remove
  that field and its shim before stabilizing.
- **`startedOnBehalfOf` is emitted but untyped.** Core still sets it on the
  context for handlers built against an older SDK. Drop the context field and
  its shim before stabilizing. The queued row's internal
  `requested_by_initiator` / `requested_by_thread_id` are unaffected.
- **One hook is not a shape.** The registry, the map and the
  `on(hook, handler)` signature are built for several hooks, and there is one.
  Confirm the second hook fits the shape before stabilizing it, or collapse
  the argument.
- **`wait` returns no row id.** The id arrives later on `message.queued`, so a
  plugin that must act on its own wait correlates by ordering or re-queries
  `threads.queue.list({ waitHolder })`. Decide whether the decision should be
  able to name a correlation key.
- **A wait has no plugin-driven release, only a plugin-driven re-ask.**
  `recheck` names no row, so one resolved condition wakes every plugin-queued
  row and every handler re-decides. Confirm the whole-queue walk is still
  right with many plugin waits and waiters, and decide whether a scoped
  variant is worth the correlation problem it reintroduces.
- **`recheck` is unauthenticated in both directions.** Any plugin can wake
  rows held by any other, and core does not tell a handler why it is being
  re-asked. Confirm no plugin needs to distinguish "core's clock" from
  "somebody asked".
- **Resolving on schedule is a contract.** A caller cannot await the walk, so
  it cannot observe whether its own row went. Confirm resolving on completion,
  with its lock-reentrancy hazard, is genuinely unwanted rather than merely
  unbuilt.
- **A handler's `sendAt` and a user's `--send-at` are the same column.**
  Confirm nothing renders a plugin's instant as a user's schedule.
- **Send-now bypasses every plugin check**, including a content-policy
  `reject`. Confirm it, or split `wait` bypass from `reject` bypass.
- **"Never started" is a thread status.** Confirm `pending` is maintained
  everywhere the old event-log probe was consulted.
- **The context DTOs.** `thread`, `project`, `environment`, `host` and
  `queuedMessage` are public DTOs; confirm they are what a plugin should
  couple to.
- **The single server-wide lock.** One slow handler delays every dispatch in
  the server, up to its 10 s box.

## `interaction.pending` (`bb.events.on`)

Fires after core commits a pending interaction. It carries the public thread
and pending interaction DTOs and is observe-only.

Docs: `backend-events.md`.

**Audit before stabilizing.** Confirm that all plugins should receive provider
and plugin interaction details. Confirm that the full interaction DTO remains
the correct payload instead of an id that requires a fresh SDK read. Decide
whether this event needs matching resolved, cancelled, or interrupted events.

## `message.queued` / `message.dispatched` / `message.cancelled` / `turn.failed` (`bb.events.on`)

These are observe-only announcements. `message.queued` (on first queue and on
every rewritten wait) and `message.dispatched` carry the `ThreadQueuedMessage`
DTO. `message.cancelled` fires when a queued row is deleted before dispatch.
`turn.failed` carries ids and failure facts after a thread lands in `error`.

Docs: `backend-events.md`.

**Audit before stabilizing.** These are the only non-thread events on
`bb.events.on`, so renaming `PluginThreadEventPayloads` and
`PluginThreadEventHandler` project-wide is part of stabilizing. Decide whether
every plugin should see every queued row (today it does, and filtering on
`entry.waitingOn` is the documented pattern) or only rows whose wait it owns.
Decide whether `message.queued` firing on every rewritten wait is what a
listener wants, or whether a separate `message.updated` belongs alongside it.
The timeline event already distinguishes the two. Rows that vanish with their
thread fire the thread event instead of `message.cancelled`. Confirm that
split is the teardown signal a plugin holding resources for a waiting message
needs. For `turn.failed`, confirm the payload answers every question a retry
policy asks without replaying the event log. Attempt caps are entirely the
plugin's; core enforces no ceiling beyond one live retry row per original
request.

## `bb.experimental_environments` (`register`, `recheck`)

Registers an environment provider: a named place threads run. Ids are flat
and first-wins, and the persisted owner plugin is the only one that can
recover or remove its resources. It declares `requires` eligibility facts,
Standard Schema `inputs`, optional `validate`, and durable `create`/`remove`
resource operations that core drives. `recheck` schedules another pending
launch attempt. The built-in checkout, worktree and personal workspace
behaviors are first-party plugins.

Docs: `backend-events.md`.

**Audit before stabilizing.**

1. **Requirement vocabulary.** `requires` has four booleans, each a fact core
   evaluates before the thread exists; everything else goes through `inputs`.
   Decide whether the next fact fits that shape, and whether `gitCheckout`
   should carry more than "a git repository with commits", before it is
   frozen.
   1a. **Inputs at the boundary.** The schema is plugin code core runs inside
   the request: a slow or throwing schema costs the request, and the JSON
   Schema conversion happens once at registration and may fail load. Decide
   whether core should bound the parse, and whether the row should store the
   raw request value alongside the parsed one so a schema change can re-parse
   it.
2. **Single-provider invocation.** Confirm asking the one named provider (vs.
   the `message.dispatch` chain) stays the right model once several provider
   plugins ship, and that the "not registered" wait + backoff is the right
   degradation for an uninstalled plugin.
3. **Undeclared facts: `suggestedBranchName` and `projectCheckout`.** Every
   create gets a branch name built from the thread title and
   `managedBranchPrefix`, and the project's checkout on its machine, whether
   or not the provider uses them. Decide whether both belong on the context
   for everyone or behind a declaration flag, and whether a path is all a
   provider needs to know about a checkout it did not make.
4. **Durable operations.** Audit cancellation races, provider reload during
   work, and restart checkpoints against the environment-provider contract
   below.
5. **Compatibility fields.** Retain the deprecated `managed`, `isWorktree`,
   `workspaceProvisionType` and display-kind fields for the agreed cycle.

## `@get-bb/plugin-sdk/environment-provider`

Exports the resource-operation contract for
`bb.experimental_environments.register`. It also exports optional
`availability(context)` and `restore(context)`. `availability` is cached per
project and machine, re-checked at thread creation, and reported to pickers
as `machineAvailability`. `restore` is the only way core rebuilds a destroyed
environment.
`PluginEnvironmentProviderCreateContext.experimental_claimPath(path)` durably
reserves a host path on the launch row before mutation, and resolves false for
competing claims or stale attempts. Values keep their prefix, and named types
are unprefixed.

Docs: `backend-events.md`.

**Audit before stabilizing.** Verify monotonic attempts and path-key recovery
across cancellation/restart; per-environment removal serialization; retry
caps and timing defaults (5 minutes/60 seconds/30 seconds/3/per-thread/null);
resource privacy and the 16 KiB boundary; create-timeout aborts; and the
read-only lifecycle projection. Decide whether restore should stay a separate
method or become a create mode. Decide whether a provider needs a way to
decline before the restore button is offered (git worktree fails after the
click when no branch was recorded). Decide when to stop passing the retired
`rebuild: false` / `previous: null` create fields at runtime. Audit
availability message ownership, create-time error presentation, the
interaction between the `requires` floor and provider decisions, and whether
the current decision timeout is appropriate. Stabilize `experimental_claimPath`
after auditing restart, cancellation, competing checkout, and
path-reservation behavior.

## `app.slots.experimental_environmentProviderInputs`, `experimental_BranchPicker`, `experimental_useBranches` and `experimental_useCheckoutState` (`@get-bb/plugin-sdk/app`)

The slot registers `{ environmentProviderId, component }`, the control the
New Thread environment picker renders beside that provider. Its props are
`{ projectId, target, value, onChange }`. `target` is
`{ kind: "existing-host", hostId }` or `{ kind: "new-host" }`. The control
reports `{ status: "ready", value }` or `{ status: "blocked", reason }`.
Inputs are persisted and readable by every plugin, so they must hold no
secrets. The branch picker, branch hook and checkout-state hook are the host's
branch and checkout primitives for such controls.

Docs: `frontend-components.md` (environment row, branch and checkout
primitives). Only the API index names the slot registration itself.

**Audit before stabilizing.**

1. **Slot placement.** The control renders where the branch picker sits.
   Confirm that stays right for providers with larger configuration (a dialog
   escape hatch?) before freezing.
2. **Validity channel.** Confirm ready/blocked remains sufficient and decide
   whether the picker should run the published JSON Schema client-side before
   submit.
3. **Branch API breadth.** Confirm the picker props and branch-hook result
   stay sufficient for providers, with branch loading, search and remote
   refresh owned by the host and selection models owned by the plugin.
4. **Missing slot.** A provider whose schema requires non-empty input and
   whose app entry registers no slot cannot be picked from the app (the CLI
   can still send `--environment-inputs`). Decide whether load should refuse
   that pairing.
5. **Mount-time default.** A control that wants the row submittable at once
   reports ready from an effect on mount. Decide whether the registration
   should instead declare a default value.

## `app.slots.experimental_machineProviderInputs` (`@get-bb/plugin-sdk/app`)

Registers `{ machineProviderId, component }`, a compact control for one
machine provider's inputs. It renders in the New Thread toolbar when a
selected composition declares machine inputs. The component receives
`{ value, onChange }` and reports ready JSON or a blocked reason. The value
must contain no secrets.

Docs: `frontend-components.md`.

**Audit before stabilizing.** Confirm the compact-chip and responsive-drawer
shape works across machine providers, that ready/blocked is sufficient, and
that provider changes and crashed controls cannot retain stale launch inputs.

## `bb.experimental_machines` (`register`)

Registers a project-independent machine provider: required id, displayName,
description, icon, `create`, `reconcileCleanup` and `remove`; optional
`ephemeral`, Standard Schema inputs, availability, validate, and paired
suspend/resume. Core owns enrollment, durable launches, cleanup retries and
lifecycle transitions. Plugins own allocation, filesystem preservation and
idle policy. The lifecycle context's `checkpoint(resource)` persists a
bounded (16 KiB), credential-free recovery record.

Docs: `backend-machines.md`.

Before stabilization, verify registration validation, creation-key ownership,
interrupted allocation cleanup, checkpoint rejection, resource privacy,
removal serialization and same-identity restoration. Machine lifecycle uses
removing; removal retry timing is internal, not a public retirement policy.
The checkpoint requires real-DB crash recovery after allocation and before
bootstrap, competing lifecycle operations, wrong-owner rejection and no
duplicate enrollment. Standalone SDK submit/launch/follow/cancel must match
CLI create/status/cancel.

## `@get-bb/plugin-sdk/machine-provider`

Exports the machine provider's definition, input, availability/validation,
create and lifecycle context, progress, and resource/removal types. These
supporting declarations belong to the experimental machine namespace, so
their unprefixed names do not mean they are stable.

Docs: `backend-machines.md`.

Stabilization follows `bb.experimental_machines` above.

## `bb.branding.experimental_icons` (manifest) and namespaced presentation glyphs

A manifest map from names to plugin SVG files. Timeline presentation glyphs
and provider `icon` may reference an entry as `"<pluginId>/<name>"`. The map
is validated at build and load. Ingest rejects a glyph that is not the
emitting plugin's own declared icon. `bb.branding.icon` refuses the namespaced
form.

Docs: `quickstart.md` (manifest and SVG rules), `providers.md` (provider
icons), `backend-cli-agents.md` (tool presentation).

**Audit before stabilizing.** Decide whether the key becomes `icons`. The
strict manifest schema makes that rename breaking, so the stabilization
release must accept both for one release. Decide whether `bb.branding.icon`
should resolve a self-referencing namespaced glyph through the map instead of
refusing it. **Open question for a major release:** whether to tighten logos
and provider icons at install and load, to the build rules or to the full
declared-icon rules. Today logos are checked only at build for script
vectors, and `nosniff` plus a `default-src 'none'` CSP keep served files
inert. Either tightening fails installed plugins whose artwork is an ordinary
tool export. It therefore needs an audit of installed marketplace and
third-party logos and a migration window first. Decide whether a full-colour
mode (`{ path, mode }` values) is wanted; today every icon is a monochrome
mask. Decide whether `toolUse` approval presentations are checked at ingest
too (today only timeline rows are). Settle whether a row persisted with a
namespaced glyph should ever be rewritten when the plugin renames or removes
the icon; today it simply falls back.

## `experimental_buildBridgeToolCallContent`

**Kept experimental (2026-08-22).** Drop the legacy input and settle the image
policy, then stabilize.

Converts a decoded bb tool-call response into the ordered text and
inline-image content blocks that MCP and Pi tool results accept. It takes
ordered `contentBlocks` or the legacy aggregate `{ content, images }`.

**Audit before stabilizing.** Confirm that MCP and Pi continue sharing this
content-block vocabulary; decide whether legacy aggregate fields still need to
be accepted; and define any image MIME validation, decoding, or payload-size
policy at the server boundary.

## The ACP bridge kit (`@get-bb/plugin-sdk/provider-bridge/acp`)

**Kept experimental (2026-08-22).** Four members remain, each with an open
question below. The kit grows with a consumer, not ahead of one.

`experimental_acpProviderBridge` is the generic Agent Client Protocol bridge a
plugin re-exports. It launches the agent named by
`providerOptions.acpLaunchSpec` with a dialect (`generic`, `cursor`, `grok`)
from bridge options. `experimental_probeAcpAgent` asks an installed agent for
its `agentCapabilities`, and `experimental_acpAgentProbeSchema` validates the
answer across a host RPC boundary. `experimental_acpLaunchSpecSchema` /
`AcpLaunchSpec` is the launch spec the bridge parses.

Docs: `providers.md` (ACP agents). No doc covers the probe or launch-spec
contracts.

**Audit before stabilizing.** Decide what `probeAcpAgent` owes a caller.
Today it spawns the agent with a 10 s timeout, advertises the bridge's own
client capabilities, and answers `-32601` to anything the agent asks. Settle
whether the timeout, the client capabilities and the refusal are the caller's
to choose. Decide whether `AcpDialect` is the right shape for a third-party
agent before a dialect registry becomes public again. It has four optional
hooks (`toolIdentity`, `classifyToolCall`, `handleClientRequest`,
`maintenance`) and no versioning, so a fifth is a silent capability change for
every dialect. Decide whether a dialect should be named by value in the
provider registration instead of by id. Settle whether the bridge should be a
factory rather than a module singleton before a host artifact needs two
configured differently. For `acpLaunchSpecSchema`, the shape is stored in the
ACP plugin's `customAgents` setting and in registrations' bridge options. A
change therefore migrates stored agents; decide what a plugin is owed when the
spec grows a field.

## `PluginProviderDeclaration.experimental_nativeSkillRoots`

**Kept experimental (2026-08-22).** No third-party agent has validated the
relative-path / 32-root rule or the per-root options, and the split from the
per-workspace resolver is new.

Names the directories a provider's agent reads skills from: `user` relative
to the host home, and `project` relative to the workspace. bb lists those
skills beside its own.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

Decided (2026-08-22): there is no `absolute` side; host-specific roots go
through `experimental_resolvesNativeRoots`.

**Audit before stabilizing.** Decide whether the two-bucket shape (`user`,
`project`) is the right vocabulary or whether a root should name its own base
explicitly. Confirm the 32-root cap and the relative-path rule against a real
third-party agent. Decide whether this belongs on the declaration at all or
should be reported per host by the bridge, since where an agent keeps its
skills can differ per machine (today that difference is the resolver's job).
Audit whether the per-root options and symlink boundary rule are the right
vocabulary, or whether a root should carry a shape like the resolver's answer
does.

## `PluginProviderDeclaration.experimental_nativeCommandRoots`

The same two-sided declaration, with the same per-root options, for flat
directories of `*.md` slash-command prompt files.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

**Audit before stabilizing.** Decide whether commands and skills should stay
two declarations or become one list of typed roots; confirm that a flat
`*.md` directory is the only command layout a third-party agent needs.

## `PluginProviderDeclaration.experimental_resolvesNativeRoots`

Declares that the plugin's `bb.host` entry serves
`resolveNativeRoots({ providerId, cwd })`. bb scans the answer beside the
declared roots (cached ten seconds). A failed answer yields no resolved roots
and never fails the listing.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1.

**Audit before stabilizing.** Decide whether the flag should exist at all or
whether the server should detect the method on the host entry; and settle
the cache TTL and the invalidation set against a real multi-host setup.

## `experimental_nativeRootsHostContract` (`@get-bb/plugin-sdk/host`)

The one-method host RPC contract (`resolveNativeRoots`). Input is
`{ providerId, cwd: string | null }`. Output is `{ skills, commands }`, each a
list of host-absolute roots with `origin`, `recursive`, `ancestors`,
`namePrefix`, and a `shape` that tells the daemon how to read the root.

Docs: `providers.md`.

**Audit before stabilizing.** Confirm the shape vocabulary covers a
third-party agent's layouts; decide whether the contract should accept a
relative path the daemon resolves (so a plugin need not know the host home)
and whether the 256-root cap per side is right.

## `experimental_filterResolvedNativeRoots` (`@get-bb/plugin-sdk/host`)

Checks a `resolveNativeRoots` answer root by root against the contract. It
drops each failing root with a warning, and truncates a side past 256 roots,
so one bad root cannot void the whole listing.

Docs: `providers.md`.

**Audit before stabilizing.** Decide whether the per-root leniency belongs in
the contract's output schema itself (drop at the boundary, report the drops
in the answer) so a plugin cannot forget to call the helper, and whether
`dropped[].reason` is a contract a resolver's test may pin or free text for
the log.

## Vendor plugin roots (`experimental_resolveClaudePluginRoots` and `experimental_resolveVendorPluginRoots`, `@get-bb/plugin-sdk/host`)

`experimental_resolveVendorPluginRoots({ plugins, layout })` walks vendor
plugin directories into native roots with `namePrefix: "<plugin>:"`.
`layout: "claude"` reads each plugin's root `SKILL.md`, `skills/`, `commands/`,
then its manifest `skills` and `commands` entries. `layout: "grok"` reads only
the manifest entries, each recursive.
`experimental_resolveClaudePluginRoots({ cwd, homeDir, env })` reads Claude
Code's installed-plugin registry and enablement settings and runs the walk.
Its answer also carries `claudeDir`. Two shared rules apply. User-origin
plugins follow skill symlinks, project-origin plugins do not, and command
components never follow links. Within an answer each path appears once per
side, and the first root to claim it wins.

**Audit before stabilizing.** Decide whether the walk should keep taking a
layout name (`claude`, `grok`) or the two facts behind it (conventional roots
on or off, directories recursive or flat) once a third vendor layout appears;
whether `claudeDir` belongs on the answer or the reader should also answer the
config directory's own roots; whether a skills-only caller should be able to
ask for one side; whether the repeated-path rule should be the contract's
(drop at the boundary, first root wins) rather than each helper's; and whether
a plugin's `name` should be validated as a name prefix here instead of at
`experimental_filterResolvedNativeRoots`.

## `PluginSettingDescriptor.experimental_multiline`

A `type: "string"` descriptor flag that renders a multi-line monospace editor.
The stored string is unchanged. A descriptor that combines it with
`secret: true` is refused.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

1. **Name and shape.** Decide whether to stabilize as a boolean `multiline`
   or replace it with a `json` descriptor type that validates at the boundary
   (pretty-printing, parse errors shown in the form, a typed value from
   `settings.get()`), which would make this flag redundant for its first
   consumer. A `multiline` boolean still has a use for plain lists, so the two
   may coexist.
2. **Mobile.** Confirm that phones need the editor at all (a JSON array is
   hard to type on a soft keyboard), or whether the mobile form should show
   the value read-only with an "edit on desktop" note.
3. **Unknown descriptor fields.** The strict client schema turns every new
   presentation hint into a client release. Decide whether descriptor schemas
   should tolerate unknown fields so a hint degrades to the one-line input on
   an older client instead of failing the whole settings view.

## `bb.server.experimental_dataDir`

**Kept experimental (2026-08-22).** A bare data-directory path does not
stabilize.

The server's data directory. Its only consumer is the Account Pool plugin,
which keeps secret files under `plugins/<pluginId>/secrets/accounts`.

Docs: `backend-foundation.md`.

**Audit before stabilizing.** Decide whether the Account Pool plugin's secret
files can move to a plugin-scoped primitive so the member can go. If it stays,
decide whether a bare path is the right shape or whether a plugin should get
named accessors for the bb-managed locations it may use. A path invites
writes into bb's directory, which `bb.storage` exists to prevent.

## `bb.server.experimental_appUrl`

The operator-configured public app URL from `BB_APP_URL`, or `null`.

Docs: `backend-foundation.md`.

**Audit before stabilizing.** Decide whether `BB_EXTERNAL_URL` or the bb
connect URL should supply this value when `BB_APP_URL` is empty. Confirm that
one public URL has clear behavior when a server has several access paths.

## Bridge record mode (`experimental_recordProviderChildIo` and `experimental_isProviderBridgeRecording`)

**Kept experimental (2026-08-22).** The recording entry shape is a de-facto
fixture format consumed by the testing kit, so it must be frozen together
with `experimental_readBridgeRecording` / `experimental_replayRecording`. The
`{ threadId | null }` scope is untested against a multiplexing bridge.

`experimental_recordProviderChildIo` tees a provider child's stdio into record
mode and is a no-op when record mode is off.
`experimental_isProviderBridgeRecording` reports whether record mode is on.

Docs: [provider-bridge-protocol.md](provider-bridge-protocol.md) "Record
mode", `providers.md`.

**Audit before stabilizing.** Decide whether the bridge kit should own the
spawn itself (one helper that spawns and records) instead of a post-spawn
hook; confirm the `{ threadId | null }` scope is the right key once bridges
multiplex several threads over one child; and settle the recording entry
shape (`{ ts, run, seq, dir, line }`) as a documented fixture format.

## Portable provider spawn (`experimental_spawnPortableProcess`, `experimental_killPortableProcess`) (`@get-bb/plugin-sdk/provider-bridge`)

`experimental_spawnPortableProcess({ command, args, cwd?, env?, stdio?, detached? })`
returns a `ChildProcess` launched the way the daemon launches one. On Windows
it resolves PATH/PATHEXT, runs npm `.cmd` shims, and hides the console;
elsewhere it behaves like `spawn`. `experimental_killPortableProcess(child, signal)`
terminates the whole process tree on Windows and sends `signal` to the child
elsewhere.

**Audit before stabilizing.** Decide whether bridges should receive the managed
process handle (an awaited stop that reports whether the tree is confirmed
gone) instead of a raw `ChildProcess` plus a fire-and-forget kill. Confirm
argument quoting for `.cmd` targets with untrusted arguments, and whether
`detached` belongs in the public shape.

## `experimental_BridgeRecoveryError`

**Kept experimental (2026-08-22).** It stabilizes together with
`experimental_defineProviderBridge` / `experimental_apiVersion` in the
bridge-kit audit.

A request handler throws it to reject the request with a JSON-RPC `code` and
`error.data.recovery { kind, message, retryable }`.

Docs: [provider-bridge-protocol.md](provider-bridge-protocol.md) "Recovery
hints".

**Audit before stabilizing.** Confirm the five kinds cover what third-party
bridges need to say about a rejection (installation was deliberately left to
`provider/installation/*`). Decide whether `retryable` should be per kind
(only `sessionArchived` and `rateLimited` read it today) and whether the
runtime should bound the `rateLimited` ladder from the hint rather than from
a constant.

## Provider maintenance toolkit (`experimental_resolveExecutablePath`, `experimental_readCliVersion`, `experimental_commandOutput`, `experimental_versionFrom`, `experimental_compareVersions`, `experimental_formatCommand`, `experimental_npmCommand`, `experimental_npmGlobalInstallCommand`, `experimental_npmLatestVersion`, `experimental_probeNpmGlobalPackage`, `experimental_npmGlobalInstallSource`, `experimental_installationVerification`, `experimental_downloadedInstallerCommand`, `experimental_clampPercent`) (`@get-bb/plugin-sdk/provider-bridge`)

These are the host-local probes and install commands behind a bridge's
`provider/health`, `provider/usage` and `provider/installation/*` answers for
a user-installed CLI.

- Probes: `resolveExecutablePath` returns an absolute path or null, and on
  Windows prefers a PATHEXT match such as an npm `.cmd` launcher.
  `readCliVersion` runs `--version` with stdin closed and returns the first
  valid SemVer token or null. `commandOutput` returns trimmed stdout+stderr
  or null. The others are `versionFrom`, `npmLatestVersion` and
  `probeNpmGlobalPackage`.
- Decisions: `compareVersions` uses SemVer precedence and throws `TypeError`
  on invalid input. `npmGlobalInstallSource` returns `npmGlobal`, `external`
  or `notInstalled`. `installationVerification` passes an install on
  existence, and an update on reaching the latest version (or any change
  when the registry was unreachable).
- Actions: `npmGlobalInstallCommand`; `downloadedInstallerCommand`, which runs
  a vendor script from a temp file and, given `powershellUrl` on Windows,
  returns `irm <url> | iex`; `npmCommand`; `formatCommand`; and
  `clampPercent`.

**Audit before stabilizing.**

1. **Timeouts are fixed.** 5 s for `which`/`--version` and 15 s for npm and
   self-diagnostics, so a bridge whose CLI is slow to start (a JVM, a
   first-run download) cannot lengthen them. Decide whether the budgets
   become arguments before the signatures are a promise.
2. **`compareVersions` throws.** Confirm the throwing contract for invalid
   inputs before stabilization.
3. **The npm helpers assume a global install.** `probeNpmGlobalPackage` and
   `npmGlobalInstallSource` model npm's global prefix only; pnpm, volta and
   corepack shims read as `external`. Decide whether the source enum should
   grow before it is relied on.
4. **`downloadedInstallerCommand` without `powershellUrl` is POSIX.** On win32
   it still returns `sh -c` with `mktemp`, `curl` and `bash`. Decide whether it
   should refuse there rather than hand the daemon a command that cannot run.

## Presentation builders (`experimental_presentationTitle`, `experimental_presentationDetail`, `experimental_withTitle`, `experimental_presentationFileName`, `experimental_COMPACTION_PRESENTATION`, `experimental_REASONING_PRESENTATION`, `experimental_fileReadPresentation`, `experimental_searchPresentation`, `experimental_webSearchPresentation`, `experimental_webFetchPresentation`, `experimental_planStepsPresentation`, `experimental_toolPresentation`) (`@get-bb/plugin-sdk/provider-bridge`)

These build the grammar-v3 `presentation` a bridge stamps on every item
([provider-plugin-api.md](provider-plugin-api.md) §3 owns the vocabulary).
`presentationTitle` takes the first non-empty line capped at 160 characters,
or undefined. `presentationDetail` caps a detail at the persisted schema's 280
characters. `withTitle` stamps a title only when there is one, and
`presentationFileName` returns the last path segment. The two constants carry
bb's fixed wording for compaction and reasoning rows. The five builders shape
file read, search, web search, web fetch and plan-steps rows, and
`toolPresentation` is the generic "Running/Ran <tool>" row.

**Audit before stabilizing.**

1. **The wording is a product decision.** A bridge that adopts the constants
   inherits bb's English labels and glyph names. Decide whether the labels
   should come from the host (localized, themed) rather than be persisted from
   the bridge before the constants are a promise.
2. **The caps are the schema's.** Stabilizing the helpers freezes the
   160-character headline cap (a kit convention) and the 280-character detail
   cap (the persisted schema's) as public behavior.
3. **Plan-steps rows collapse by default.** `experimental_planStepsPresentation`
   sets `suppress: true` (the todo banner reads the snapshot); codex keeps its
   own uncollapsed variant. Decide which default a third-party bridge should
   get.

## `experimental_readBoundedLines` (`@get-bb/plugin-sdk/provider-bridge`)

A newline-delimited line reader. It frames on LF only (never `readline`, which
also splits on U+2028/U+2029) and strips a trailing CR. A line over
`maxLineBytes` (default 64 MiB) is discarded up to its terminator and reported
through the required `onOverflow` with its byte count. The optional `onClose`
fires after a final unterminated line is emitted.

**Audit before stabilizing.**

1. **The default cap is the wire's.** `maxLineBytes` defaults to the JSON-RPC
   line bound the runtime applies to the bridge itself; a provider child's
   payloads may deserve a different bound. Decide whether the default should
   be an explicit argument for child pipes.
2. **`onOverflow` is required.** A bridge might reasonably want to fail the
   session instead of logging the drop. Decide whether the reader should offer
   a fail-closed mode before the signature is a promise.

## Live-file navigation (`experimental_FileLink`, `BbNavigate.experimental_openFilePreview`, and `BbNavigate.experimental_openFileExternally`)

**Kept experimental (2026-08-22).** Windows/UNC paths were never verified and
`experimental_openFilePreview` has no consumer.

`experimental_FileLink` and `experimental_openFilePreview` open explicit live
workspace, host and thread-storage file targets through the current surface's
shared file-tab controller. `experimental_openFileExternally` opens a target
in the client's preferred external app. The boolean results report host
acceptance, and malformed targets stay inert.

Docs: `frontend-components.md`, `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Verify strict target/path/location validation on POSIX, Windows drive, and
   UNC paths, including stale environment, host, and thread identities.
2. Confirm preview identity, persistence, opener preference, one-off Open with,
   disabled opener fallback, and explicit-host migration on Thread, New-thread,
   Settings, and plugin-page surfaces.
3. Audit external opening across local and remote clients, disconnected hosts,
   missing preferred apps, and targets with line but not column support.
4. Confirm link anchor behavior, unavailable menu states, copy semantics, and
   whether per-app external choices should remain host-owned menu affordances
   rather than become plugin-selectable API.
5. Measure the lazy boundary: mounting a file link must not start file reads,
   preview imports, editor discovery, or panel-destination loading.
6. Decide whether Git snapshots or deleted working-tree files merit separate
   target variants; do not weaken live-file guarantees to accommodate them.

## Host plugin foundation (`bb.hosts.experimental_client`, `ExperimentalHostClient.experimental_onWorkerExit`, `ExperimentalHostClient.experimental_onSignal`, `ExperimentalHostRpcContext.experimental_retainWorker`, `experimental_defineHostEntry`, `experimental_killProcessesWithCwdUnder`, and `experimental_createHostEntryHarness`)

**Kept experimental (2026-08-22).** Signals and watches have no consumer
(decide whether to delete them or keep them experimental separately from
calls). None of the lifetime/limit numbers has been measured against a plugin
other than keep-awake. The artifact-contract names (`experimental_apiVersion`,
`experimental_signals`, the injected context members) are read by the daemon
from installed artifacts, so renaming them needs a dual-name window plus a
protocol bump.

A plugin declares one `bb.host` Node entry with
`experimental_defineHostEntry`, shares a Standard Schema contract with its
server, and calls methods on an explicit enrolled host through
`bb.hosts.experimental_client`. The client can observe unexpected worker exits
and ephemeral host signals. Handlers can hold retention leases, and idle
workers are evicted after five minutes. `experimental_killProcessesWithCwdUnder`
reaps processes working under a directory before it is deleted.

Docs: `backend-foundation.md`, `testing.md`.

**Audit before stabilizing.**

1. **Process reap.** Confirm `experimental_killProcessesWithCwdUnder`'s
   platform coverage (Linux `/proc`, macOS `lsof`) and whether the grace
   should be per call.
2. **Call timeout.** `ExperimentalHostCallOptions.timeoutMs` defaults to 30 s
   and is capped at 30 minutes. Confirm the cap, and whether the default should
   be declared per method on the contract instead.
3. **Contract shape.** Confirm Standard Schema values remain the right runtime
   boundary and decide whether method-specific typed errors are necessary.
4. **Targeting.** Confirm explicit host ids are enough for V1 and add an
   environment-aware primitive only alongside a plugin that proves its
   locking and workspace semantics.
5. **Process lifetime.** Measure whether five idle minutes is the right timeout,
   whether watches should continue retaining automatically, and whether leases
   acquired only during active handlers are expressive enough. Confirm there is
   no need for manifest lifetime flags, plugin-selected timeouts, a global
   worker limit, or plugin-specific restart policy. Confirm unexpected-exit
   notification is the right generic repair trigger, remains suppressed for
   graceful and idle disposal, and does not create crash loops.
   Verify reconnect generation reconciliation covers disable/uninstall during
   an outage without stopping a still-current worker on every transient drop.
6. **Signals and watches.** Confirm host signals should remain private,
   ephemeral invalidations rather than a durable event log. Audit native-watch
   coalescing, backpressure, rescan/error events, per-worker limits, and cleanup
   against a plugin that watches real workspace state.
7. **Paths.** Confirm the stable host data path layout and generation-temporary
   cleanup behavior across crashes and daemon restarts.
8. **Limits.** Audit the common call duration, startup/cancellation grace, 8
   MiB JSON payload cap, 256 MiB artifact cap, and per-plugin admission limits
   (256 active calls / 32 MiB of active inputs) against real plugins. Confirm
   retaining only the most recently materialized artifact digest per plugin is
   sufficient.
9. **Environment.** Confirm executable discovery through normalized `PATH`
   and stripping all daemon-owned `BB_*` variables.
10. **Trust and dependencies.** V1 host plugins are trusted Node programs that
    may use `child_process`, filesystem, and network APIs. Decide whether later
    permissions, native artifacts, or an explicit dependency installer can be
    layered on without changing the RPC contract. Confirm rejecting all private
    `@bb/*` imports from host bundles is the correct permanent boundary, and
    audit the builder-supplied public SDK runtime against future host exports.
11. **Composition boundary.** Confirm host RPC methods and signals should remain
    private to the owning plugin while allowing another daemon subsystem to
    consume the same `bb.host` artifact through its own bootstrap and lifecycle.
12. **Test harness.** Audit both layers. The server harness has the
    `experimental_callHostRpc`, `experimental_hostEntry` and
    `experimental_declaredIconNames` options, the `experimental_hostRpcCalls`
    inspection list, and the `experimental_emitHostWorkerExit` and
    `experimental_emitHostSignal` drivers. The host-entry harness has
    `experimental_call`, `experimental_getSignals`,
    `experimental_getRetainedWorkerLeaseCount`, `experimental_lifecycleSignal`,
    path/watch options, and `experimental_dispose`. Confirm the host harness
    should continue simulating validation, cancellation, lifecycle, JSON, and
    size limits without pretending to model process startup, crashes, native
    watcher recovery, or reconnect behavior.

## Fixed-tab targets (`experimental_target`, `experimental_useAppPanel`, and `experimental_useFixedTabTarget`)

**Kept experimental (2026-08-22).** `PluginNavPanelRegistration.fixedTabs`
itself is stable. The target trio has one example consumer, and the
validator, survival and cross-thread items below are unanswered.

A fixed tab's `experimental_target` validator owns a JSON-safe target type.
`experimental_useAppPanel()` selects one of the calling plugin's eligible tabs
on the current surface and can submit a target.
`experimental_useFixedTabTarget()` returns the validated current-session
target with a sequence and `clear()`. Targets are memory-only: they survive
remounts but not a refresh.

Docs: `frontend-core-slots.md`, `frontend-components.md`.

**Audit before stabilizing.**

1. Audit registration objects as references: identity is scoped to the mounted
   plugin and current nav panel, with no cross-plugin addressing or global ids.
2. Confirm sync type guards remain the right owner validation contract and
   define error reporting if a validator throws or becomes stale after reload.
3. Exercise repeated equal targets, explicit clearing, crashes, inactive-tab,
   panel, and route remounts, refresh, and compact drawer animation. Targets
   must survive remounts in the current app session, never survive refresh, and
   never reappear after their owner clears them.
4. Decide whether a future cross-thread surface should navigate before opening;
   the initial public surface intentionally supports only `{ kind: "current" }`.
5. Keep core and plugin destinations on the same resolver and verify the
   controller never learns Changes, file, task, or document target shapes.

## `PluginNavPanelRegistration.experimental_sidebarAccessory`

**Kept experimental (2026-08-22).** It has one consumer (the tasks plugin), and
item 1 below would change the API shape.

A no-props, presentational component at the trailing edge of a nav panel's
sidebar row. It is limited to one 4rem × 1.25rem line, is not mounted on
compact viewports or the `navigationRail` icon-only rail, and fades out for the options button.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Component versus value.** Confirm real consumers need component-owned
   live state, rather than a narrower string/number/badge value plus a separate
   host update primitive. Installed plugins are trusted, but a component can
   still render controls or markup that is inappropriate for row chrome.
2. **Budget.** Revisit the 4rem by 1.25rem cap against counts, short statuses,
   localization, browser zoom, and multiple plugin rows. Decide whether the
   host should expose a fixed badge treatment instead of accepting plugin
   styling.
3. **Compact behavior.** The component is not mounted below the compact
   breakpoint, so it performs no hidden queries there and loses local state
   when the viewport crosses the breakpoint. Confirm that is preferable to a
   mounted-but-CSS-hidden subtree.
4. **Overflow and portals.** The wrapper clips ordinary descendants but cannot
   constrain content portalled elsewhere in the document. Confirm the
   presentational-only contract is sufficient, or enforce a non-component
   value before stabilization.
5. **Accessibility.** Accessory text is exposed beside the navigation button
   without changing that button's stable accessible name. Confirm that reading
   order and the focus-triggered accessory/options swap work for counts and
   short statuses, and decide whether a dedicated label prop or host-rendered
   status semantics are needed.

## `PluginContentScriptContext.experimental_setThreadRowStatus`

**Kept experimental (2026-08-22).** The collapsed-section status rollup
consumes it.

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and
clears when that frontend generation deactivates.

Docs: `frontend-core-slots.md`.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration across plugins, frontend generations, and native thread
  statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal;
- the name of `PluginComposerThreadRowStatus.tone`. The field is a state the
  plugin reports (`default | running | success | error`) that the host maps to
  both a color and an animation, so `state` is the candidate rename. Nothing
  under `plugins/*` sets a status today, so the rename is free until the
  prefix drops.

## `bb.providers.register` (`experimental_bridgeOptions`, `experimental_visibility`, and the `experimental_providerBridge` artifact export)

**Kept experimental (2026-08-22).** `bb.providers.register` and the
declaration's target-state fields are stable. `experimental_bridgeOptions` and
`experimental_visibility` have one consumer (the ACP plugin); decide whether
static options survive beside `deriveProviderOptions` before naming them. The
daemon bootstrap reads the `experimental_providerBridge` export name from
every installed plugin. Renaming it needs a dual-name acceptance window plus a
protocol bump, so it stabilizes with the bridge kit once that deprecation
policy exists.

`experimental_bridgeOptions` is bounded JSON, opaque to core, delivered to
every bridge launch as provider-scoped static options.
`experimental_visibility: "installed"` withholds a provider from unscoped
listings until its `provider/health` is not `not_installed`. The bridge is the
`experimental_providerBridge` export of the plugin's `bb.host` artifact.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §1–2.

**Audit before stabilizing.**

1. **Install-order ranking.** Bundled plugins rank by their position in
   `BUNDLED_PLUGINS`; other plugins by `installedAt`. Confirm that a
   reinstalled builtin (tombstone then reinstall) keeping its bundled rank is
   right, and that `installedAt` is the fact users expect for third-party
   order (vs. first-load time). The user overlay (`providerOrder`) is an
   ordered id list that ignores unknown ids; decide whether stale ids should
   be pruned on write.
2. **Icon URL shape.** A path or declared icon is snapshotted at registration
   and served from `/api/v1/system/providers/<id>/logo`; a host glyph name
   yields a null `logoUrl` and no server-side resolution. Decide whether the
   host should resolve declared glyph names for providers the way it does for
   plugin branding, and decide the logo route's cache policy, before either
   freezes into clients.
3. **Collision semantics.** Ids are first-come collision-rejected: a staged
   collision fails the whole plugin load; a post-activation registration
   throws to the plugin. A disabled first-party plugin leaves its id claimable
   by anyone until it is re-enabled (which then fails to load). Confirm
   first-wins is right across plugin load order, and decide whether a
   namespace rule (plugin-scoped id prefixes) is wanted before third-party ids
   proliferate.
4. **Bridge delivery.** Every provider bridge arrives as the plugin's one
   `bb.host` artifact. Confirm one artifact per plugin survives (a plugin
   declaring several providers ships one bridge for all of them, and there is
   no way to name a second), confirm the single-bundle shape survives
   per-platform needs, and decide whether a router-kind declaration (a picker
   entry resolving to another provider at submit time) returns as its own
   surface.
5. **What a capability may be.** Apply this test to every remaining
   capability before stabilizing: a declaration may assert what the provider
   itself implements and an external consumer needs pre-session, never what
   bb or its daemon can do with it.
6. **Static bridge options and visibility.** Confirm 64 KiB remains a suitable
   declaration-time limit, that opaque options should continue to be shared by
   every host rather than resolved per host, and whether deep-frozen plain JSON
   is the right stable value contract. Confirm `"always" | "installed"` is
   enough listing policy, that health failure should continue to hide an
   installed-only provider, and that targeted requests may continue resolving
   a registered provider even while discovery says it is absent.

## `@get-bb/plugin-sdk/provider-bridge` (the provider-bridge authoring surface)

**Kept experimental (2026-08-22).** `experimental_defineProviderBridge` /
`experimental_apiVersion` are an artifact↔daemon contract (the bootstrap
refuses anything but version 1 by name), and the deprecation window between
independently-updating artifacts and daemons (item 2) is undecided.

The published module a provider bridge compiles against. It holds
`experimental_defineProviderBridge`, the Provider Bridge Protocol's methods,
the `thread/delta` grammar and param schemas, the bridge kit's helpers, and
the `@bb/domain` command-plane vocabulary those params reference. It is
curated by hand with named exports only, and bundled into the plugin's
artifact rather than stubbed at runtime.

Docs: `providers.md`, [provider-plugin-api.md](provider-plugin-api.md) §2,
[provider-bridge-protocol.md](provider-bridge-protocol.md).

Decided (Aug 2026): bridges emit the protocol's own `thread/delta` grammar,
and the `@bb/domain` command-plane, interaction and enum types they reference
stay re-exported through the facade permanently.

**Audit before stabilizing.**

1. **Surface size.** 184 names. Any further shrink is a per-name product
   decision, not a mechanical move.
2. **`experimental_apiVersion` 1.** The bootstrap accepts version 1 only and
   refuses anything else by name. Decide the deprecation window for a version
   bump (a plugin's artifact and the daemon update independently) before the
   first third-party bridge ships.

## `@get-bb/plugin-sdk/provider-bridge/testing` (the provider-bridge testing kit)

**Kept experimental (2026-08-22).** Items 2 and 5 below change the public
shape (a pluggable replay child, pinning a grammar version in the exports).

The published kit a bridge author proves a bridge with, with no private
`@bb/*` package in reach. It contains the conformance runner
(`experimental_runBridgeConformance`), the real delta assembler, the
delta→event collector, the in-process JSON-RPC harness, the calibration
normalizer, and the recorded-replay harness and readers. It is
framework-agnostic and exports named members only.

Docs: `providers.md`.

**Audit before stabilizing.**

1. **Calibration normalizer scope.** `experimental_normalizeCalibrationEvents`
   interns the id fields the first-party goldens needed (`turnId`, `itemId`,
   `id`, `parentToolCallId`) and drops `providerCheckpointId`. Confirm the
   defaults against a third-party bridge's goldens before fixing them. The
   JSON-RPC harness duplicates a little of the bridge kit's envelope parsing;
   fold or keep it deliberately.
2. **Replay profile shape.** `ReplayProviderProfile` is the three seams the
   first-party bridges needed (`env`, `rewriteRuntimeLine`, `prepareState`)
   and `ReplayDialect` is the three protocols the replay child speaks
   (`json-rpc`, `claude-cli`, `pi-rpc`). A third-party bridge whose CLI
   speaks none of them cannot replay its provider lanes. Decide whether the
   dialect set grows, or whether the child becomes pluggable, before the
   profile is a promise.
3. **Two shipped programs.** The kit's bundle spawns
   `provider-bridge-worker-entry.mjs` and `replay-provider-child.mjs` from
   beside itself, so the published package carries both under `dist/`.
   Confirm the bundled bootstrap tracks the daemon's; a drift would make a
   replay differ from production in argv or framing.
4. **Workspace-path restoration.** `experimental_replayRecording` rewrites the
   replay's temp workspace back to the recorded `cwd` in every line the bridge
   emits, by textual substitution. Confirm no bridge emits that path in a form
   the substitution misses (URL-encoded, JSON-escaped backslashes on Windows).
5. **The canonical event vocabulary by name.** The kit exports `ThreadEvent`,
   `ThreadEventItem`, `ThreadEventItemPresentation` and the named item kinds as
   types only. The persisted vocabulary therefore has a second public home
   beside `ProviderInfo`, and a breaking change to an item shape is a breaking
   change to the kit. Decide whether the kit should pin a grammar version in
   its exports (the assembler already names `ASSEMBLER_GRAMMAR_VERSIONS`)
   before stabilizing.

## `experimental_scanPublicSdkOnly` (`@get-bb/plugin-sdk/testing`)

Scans a plugin package for imports outside the public SDK and an allowlist.
It returns the files read and each offending specifier: a private `@bb/*`
package, `outside-package`, `dynamic-specifier`, and `@bb/*` package.json
dependencies. The suite asserts on the result.

Docs: `testing.md`.

**Audit before stabilizing.**

1. **The allowlist is bb's.** The default admits every published SDK subpath
   and `vitest`; a plugin on another runner or another schema library must
   name it in `allow`. Decide whether the defaults should read the plugin's
   own package.json dependencies instead of a fixed list.
2. **Regex import extraction.** Specifiers are found by a regular expression,
   not a parser. A string literal split across lines is missed, and a string
   that merely looks like an import (in a comment, say) is reported. Decide
   whether a parser is owed before the scan is a promise.

## `app.experimental_useProviders` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** The hook returns `ProviderInfo`, which
carries the unresolved `icon` / `logoUrl` pair and `maintenance`. Stabilizing
the hook freezes that shape.

Returns `{ status, providers }`, the host's `ProviderInfo[]` roster in picker
order with shared cache and realtime invalidation.

Docs: `frontend-registration.md`,
[provider-plugin-api.md](provider-plugin-api.md) §5.

**Audit before stabilizing.**

1. **Routing.** The hook reads the primary-host roster (no `environmentId` /
   `hostId` argument), so installed-only providers of another machine are not
   listed. Decide whether plugins need host-scoped listing before freezing the
   signature.
2. **Icons.** A provider's SVG asset arrives as `logoUrl` (drawn as a
   `currentColor` mask) and a named glyph as `icon: { glyph }`; at most one is
   set. Decide whether `icon` and `logoUrl` fold into one `{ glyph } | { url }`
   field when `ProviderInfo` stabilizes, and whether the monochrome mask
   rendering is the contract or a full-color logo path is owed.

## `app.experimental_useCodeTheme` (`@get-bb/plugin-sdk/app`)

Returns `{ mode, name, theme }`: the active light/dark mode, the code theme
name bb renders it with, and the resolved VS Code theme document, for plugins
that render code with their own engine.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Shape of the document.** `PluginCodeThemeData` mirrors Shiki's
   `ThemeRegistrationResolved` minus the fields bb does not promise. Decide
   whether freezing a Shiki-shaped payload is right, or whether the contract
   should be bb's own normalized token model; a Shiki major that changes
   `settings` normalization changes what plugins receive.
2. **Both modes at once.** The hook serves only the active mode. Decide
   whether the state should carry the light/dark pair.
3. **Where the resolve happens.** The document is resolved in the app window
   and cached per theme name for the window's lifetime, so a custom palette
   edited on disk keeps its old document until reload. Confirm that matches
   what the built-in surfaces do.
4. **Consumer count.** One consumer today. Confirm a second engine (CodeMirror,
   xterm) needs the same payload before the prefix drops.

## `app.experimental_usePluginId` (`@get-bb/plugin-sdk/app`)

Returns the id of the plugin that owns the calling component, the same value
as `bb.pluginId`.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Hook or setup value.** Code that runs in `definePluginApp`'s setup, not
   in a component, cannot call a hook. Decide whether the builder should carry
   the id as well, or instead.
2. **Scope.** The hook throws outside a plugin slot component. Content scripts
   already receive `context.pluginId`; confirm no other frontend entry point
   needs it.
3. **Consumer count.** One consumer today. Confirm a second plugin needs it
   before the prefix drops.

## `app.experimental_useQuestionFormHost` (`@get-bb/plugin-sdk/app`)

Returns the remappable answer shortcuts bb binds while a pending interaction is
open, keyed by option index, and `registerChoiceHandler` for a chosen index.
Outside a pending interaction the map is empty and handlers never run.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Props or hook.** Decide whether the shortcuts belong in
   `PluginPendingInteractionProps` instead of a hook any component can call.
2. **Scope.** Only pending interactions bind the shortcuts. Confirm no other
   surface (a message action form, a panel) should get them.
3. **Consumer count.** Two first-party consumers (Ask User Question, pi's
   extension dialogs). Confirm a third-party form needs it before the prefix
   drops.

## `app.slots.experimental_providerIcon` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no shipped registrations, because
declared glyphs and SVG assets cover every first-party provider without a
frontend bundle. The remaining questions concern bundle loading cost and
rendering behavior.

Registers `{ providerKind, providerId, icon }`, a React component that draws
one agent, environment, or machine provider's icon in place of its served
`logoUrl`. Exact-kind registrations beat all-kind ones.

Docs: `frontend-renderer-slots.md`, `frontend-components.md`.

**Audit before stabilizing.**

1. **Scoping and overrides.** Cross-plugin icon overrides are allowed. Within
   each kind/id pair, the first claim by sorted plugin id wins and later
   claims warn. Verify kind isolation, specific-over-all precedence, and
   fallback after unload.
2. **Bundle size and boot ordering.** An icon costs a frontend bundle. A
   provider plugin's bundle is deferred until a thread of its provider is
   opened, one of its forms is requested, or its panel route is visited, so
   until then the icon is absent from the picker and sidebar. Confirm the
   cost is acceptable for third-party icon-only plugins, or add a lighter
   delivery path (e.g. a declared inline SVG string sanitized by the host)
   before freezing the shape.
3. **Disposal and identity.** Audit that a crashing plugin icon is contained
   the way other slot components are (it renders inside host chrome, sometimes
   outside a slot error boundary), and that no host surface caches the
   resolved component across a reload.
4. **Rendering contract.** The host promises only `className` and expects
   inline markup. Decide whether to enforce that (no fetches, no portals, no
   interactive content) before plugins rely on richer components, and confirm
   the accessible label story: the host derives `ariaLabel` from its own
   provider data, falling back to the provider id, and the slot supplies none.

## `experimental_ProviderModelPicker` (`@get-bb/plugin-sdk/app`)

bb's execution picker as a controlled
`{ providerId, model, reasoningLevel, serviceTier? }` component. It has
optional host/environment `routing`, `allowProviderChange`, `align` and
`disabled`, and the composer's catalog and normalization policy.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **Atomic controlled contract.** Confirm the four execution fields should
   remain one value and that selecting a provider should immediately choose its
   verified default rather than wait for an explicit model click.
2. **Routing.** Omitted `routing` follows the server's primary-machine routing;
   `{ kind: "host", hostId }` and `{ kind: "environment", environmentId }`
   cover machine- and workspace-dependent catalogs. Confirm those two routes
   are sufficient before stabilizing the discriminated union.
3. **Capability policy.** Confirm an unsupported provider should omit
   `serviceTier` while supported providers retain the controlled tier, and that
   reasoning should continue using the composer's closest-supported policy.
4. **Catalog failure and normalization policy.** Placeholder, failed, and empty
   catalogs never change the controlled value. A verified catalog, possibly
   the machine's stored one while a refresh runs or keeps failing, normalizes
   stale values while selected-only retired models survive. Confirm silent
   retention on failure and automatic correction on success are preferable to
   explicit callbacks.
5. **Scope.** Validate settings and compact-form usage in external plugins,
   especially whether they need an explicit loading/error callback. Tasks and
   Automations currently rely on the picker-owned loading/error UI.

## `experimental_PermissionModePicker` (`@get-bb/plugin-sdk/app`)

bb's permission picker as a controlled
`{ providerId, value, onChange, routing?, align?, disabled?, className? }`
component. It applies the composer's supported modes, fallback order and the
routed machine's permission ceiling.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **Controlled reconciliation.** Confirm automatic `onChange` after an
   authoritative capability/ceiling change is preferable to a separate
   invalid-state callback, and that provisional failures should remain
   read-only without changing the caller's value.
2. **Routing and provider coupling.** Confirm requiring both `providerId` and
   the shared host/environment routing is the right composable boundary. A
   provider switch across two sibling controls settles in two controlled
   updates rather than one combined execution tuple.
3. **Single-mode presentation.** Confirm compact/settings consumers should
   see a locked summary when only one mode is supported, while first-party
   composer call sites may continue hiding a non-choice.
4. **Permission ceiling behavior.** Audit hosts whose ceiling is below every
   mode a provider supports and decide whether the picker should render an
   explicit unavailable state instead of the controller's existing fallback.

## `app.slots.experimental_timelineRenderer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no extension-row consumers.
Every item is about the prop shape, so the first real renderer must precede
stabilization.

Registers `{ kind, component }` to render the expanded body of the plugin's
own extension rows (`"<pluginId>/<name>"`), of `"tool"` rows from its
providers, or of a `requestInput` form's history (`"<pluginId>/<rendererId>"`).
The row header stays host-rendered, and a crash falls back to the declarative
base.

Docs: `frontend-renderer-slots.md`, `backend-cli-agents.md` (form rows),
[provider-plugin-api.md](provider-plugin-api.md) §5.

**Audit before stabilizing.**

1. **Body versus whole row.** Decide whether a plugin may also replace the
   header (an inline widget with no disclosure, e.g. a goal card) before
   freezing the prop shape, and whether `suppress` should stay a bridge-only
   decision or the renderer may opt a row back in.
2. **Tool-row payload.** A `"tool"` row hands the renderer
   `{ arguments, output }` where `output` is the server's inline preview for
   long outputs. Decide whether the renderer gets the full output on demand or
   only the preview.
3. **Provider ownership source.** `"tool"` scoping reads the thread's
   `ProviderInfo.pluginId` from the nearest thread provider context. A host
   surface that renders rows with no such context, and a provider whose plugin
   was uninstalled, both resolve to "unknown owner", so no renderer applies;
   confirm that is the right failure mode for both.
4. **Legacy rows.** `presentation` is null on a tool row persisted before
   bridges attached one. Decide whether the renderer should see such rows at
   all, or only rows with a presentation.
5. **Mobile parity.** Mobile renders the declarative base and loads no plugin
   JS (by design). Confirm the base (label, glyph, tint, title, detail) is
   sufficient for the first-party extension kinds before a third party
   relies on a web-only upgrade.
6. **Form rows.** Decide whether form and extension rows need distinct `kind`
   values.

## `experimental_NewThreadComposer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no consumers, and items 1 (a
newly required create-thread field going missing silently) and 6
(projectless switching) need a consumer to validate.

The host-owned new-thread compose surface. It calls `onSubmit` with a
`NewThreadRequest` carrying every resolved selection, and the plugin then
creates the thread with `bb.sdk.threads.spawn`, which owns filing and
attribution.

Docs: `frontend-components.md`.

**Audit before stabilizing.**

1. **`NewThreadRequest` vs. what `threads.spawn` accepts.** Confirm every
   field still round-trips through `bb.sdk.threads.spawn` unchanged, that
   `executionInputSources` still means the same thing to the server, and that
   no newly required create-thread field is silently missing. The composer
   never reports a `providerId` provenance source even though it always sends
   an explicit `providerId`; decide whether that is correct before freezing
   the shape.
2. **Page-level behavior the adapter skips.** Fork seeds,
   quick-create-project, the guided machine-setup dialog, welcome/empty
   states, and codex-version submit blocking are deliberately absent. Confirm
   none of them has become load-bearing for correctness on a plugin surface.
   Without codex-version blocking, a plugin can submit to a machine whose CLI
   the primary surface would have refused.
3. **Draft and selection scoping.** Drafts persist under `draftKey ?? pluginId`
   and execution selections are component-local, so a plugin panel never
   rewrites the user's root-composer defaults. Confirm that is still what
   plugin authors expect, and that `draftKey` is the right knob (versus a
   per-instance ephemeral draft).
4. **No plugin composer host binding.** Plugin composer customizations,
   banners, and `useComposer()` writes do not reach it. Decide whether
   composers rendered by a plugin should participate in that surface before
   stabilizing.
5. **Seeding props and the round-trip guarantee.** The `default*` props are
   uncontrolled seeds that re-seed on any value change, including
   user-touched selections. `defaultEnvironment` cannot represent
   `project-default`, `personal` without a `hostId`, or an `unmanaged` `path`.
   Confirm the seed mapping still inverts the root composer's environment
   resolution, and decide whether re-seed-on-change should instead be an
   explicit reset nonce.
6. **Projectless contract.** The picker always offers "Don't work in a
   project", even when a plugin seeds a specific project; that choice submits
   the personal-project id with a `personal` workspace. Confirm unconditional
   project switching is right for embedded plugin workflows, rather than
   adding an explicit project-locking policy.

## `app.slots.experimental_appOverlay` (`@get-bb/plugin-sdk/app`)

Mounts a no-props plugin component once per app window, outside route-owned
layout, with app-level SDK hook context. A crash hides only that overlay.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Name and boundary.** Confirm "app overlay" is broad enough for floating
   widgets, launchers, and transient app-wide UI without inviting plugins to
   replace host-owned navigation or layout.
2. **App-level versus pane-level context.** Define the selected route in split
   layouts and document which pane-local capabilities remain unavailable to a
   once-per-window owner, including composer and side-panel hosts.
3. **Host-owned layer.** Decide whether arbitrary fixed/portalled content is
   sufficient or bb should provide a named overlay root, z-index band,
   collision area, docking, or drag persistence.
4. **Responsive and accessibility policy.** Audit keyboard access, focus
   restoration, escape behavior, compact drawers, reduced motion, and whether
   any of those must become host-owned rather than plugin-owned.
5. **Multiplicity and budgets.** Registrations are additive with no cap.
   Measure startup, query fan-out, visual collisions, and several plugins
   mounting persistent widgets in one window.
6. **Lifecycle.** Verify exact once-per-window mounting across route changes,
   split changes, frontend reload, disable, uninstall, app teardown, and
   multiple desktop windows or browser tabs.
7. **Crash and stylesheet lifetime.** Confirm a hidden crash fallback and the
   standard slot-owned CSS retention are the right failure semantics for UI
   that may have no in-layout representation.

## `app.slots.experimental_newThreadPanelAction` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no consumers, and item 5 is
deferred until an external plugin adopts it.

Adds a row to the root New thread screen's right-panel Actions list. The row
can open a closable tab with `{ projectId: string | null, params: JsonValue | null }`.
It is separate from `threadPanelAction`, which requires a `threadId`.

Docs: `frontend-core-slots.md`.

Before stabilization, audit:

1. **Surface naming.** Confirm "New thread" remains the product name and the
   slot should stay panel-specific rather than becoming a broader root-compose
   action surface.
2. **Context breadth.** Confirm the selected `projectId` is sufficient. A
   plugin can use the composer hooks for the live draft, but the slot does not
   expose the root composer's selected host, environment, provider, or model.
3. **Project changes.** An open tab receives the current project on every
   render, while `run` receives the project selected when the row was
   activated. Confirm that distinction is intuitive and whether changing
   projects should close or re-key open tabs.
4. **Persistence.** Tabs and JSON params persist in the root panel's fixed
   state. Confirm restoring a plugin tab before registrations load, after a
   plugin is removed, and in projectless compose has the right fallback.
5. **Relationship to `threadPanelAction`.** Confirm separate opt-in remains
   preferable to a unified discriminated context after external plugins have
   had time to adopt the root surface. Decided: both contexts' `openPanel`
   take `PluginPanelActionOpenOptions` and return `boolean`. Audit only
   whether the two contexts should merge.

## `app.experimental_sidebarFooter` (`@get-bb/plugin-sdk/app`)

Registers host-rendered icon items in the sidebar footer: an `action` with
`onActivate`, or a `disclosure` whose component is revealed above the row and
receives `dismiss()`. A disclosure registration returns an
`open`/`close`/`toggle` controller, and only one disclosure is active across
all plugins.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Naming and shape.** Confirm `sidebarFooter`, `action`, and `disclosure` are
   the durable concepts, and whether the managed namespace should keep one
   discriminated `register` method or split registrations by behavior.
2. **Imperative controller.** Validate real plugins can issue open requests
   without leaking subscriptions across frontend generations. Decide whether
   a declarative external-store contract would be safer.
3. **Programmatic opening.** Confirm `open()` should remain available. The
   intended policy is direct user-driven flows; background changes should not
   surprise-open sidebar content.
4. **Disclosure lifecycle.** Components currently mount only while open and
   remount after dismissal. Confirm plugins do not require retained hidden state,
   or add an explicit retention policy before stabilizing.
5. **Footer capacity.** Establish overflow behavior when several plugins
   register items, including compact viewports and icon-collapsed sidebars.
6. **Compatibility.** Migrate representative users of
   `sidebarFooterAction`, then decide whether stabilization replaces and
   deprecates that method or keeps action registration in both surfaces.
7. **Focus and dismissal.** Validate icon toggling, Escape, focus return,
   disclosure replacement, plugin reload, crash isolation, and removal while
   open across desktop and compact sidebar layouts.

## `app.slots.experimental_sidebarNavigation` (`@get-bb/plugin-sdk/app`)

Replaces the bounded sidebar navigation controls. bb keeps the drawer, thread
list, footer, resize handle and shortcuts. bb's own rows ship as the bundled
Navigation plugin, and `sidebar.navigationProvider` picks the provider
(default `__automatic__`). The component receives `isCompactViewport` and
`experimental_Original`.

Docs: `frontend-registration.md`,
`frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Boundary.** Verify plugins can express useful navigation without control
   of the drawer, thread list, footer, resize handle, or shortcuts.
2. **Crash and delegation.** Verify the crash placeholder and
   `experimental_Original` never recurse or remount the thread list and
   footer. Remove `experimental_Original` once released plugins (Compact Nav
   0.1.x) no longer render it.
3. **Arbitration.** Confirm Automatic preferring installed navigation over
   the bundled plugin, in plugin-id order, is right when several navigation
   replacements exist.
4. **Customize handoff.** Confirm providers accept the host editor replacing
   their region, and that focus returns to the control that opened it from a
   button, a dropdown item, and a context-menu item.

## `experimental_useSidebarNavigation`, `experimental_useSidebarNavigationSplit`, `experimental_SidebarNavigationIcon` (`@get-bb/plugin-sdk/app`)

`experimental_useSidebarNavigation()` returns
`{ items, activeItemId, isShortcutModifierHeld, actions }` from one shared
host model. Its actions are `activate`, `setVisible`, `setOrder`,
`openCustomize`, `openDetails` and `disablePlugin`, and they are inert after
unmount or outside the sidebar. The split hook mirrors
`experimental_useSidebarThreadSplit`, and the icon component renders bb's
navigation glyphs.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Semantic items.** Confirm the action and icon variants cover current
   navigation without exposing routes or host React elements, including the
   Skills and Automations destinations.
2. **Accessory as a component.** Confirm handing providers a host-wrapped
   component is preferable to a value contract, given the same questions as
   `PluginNavPanelRegistration.experimental_sidebarAccessory`.
3. **Order semantics.** Confirm `setOrder`'s partial-order rule (unknown ids
   dropped, omitted ids keep relative order at the end) works for
   drag-and-drop in real providers, and that entries for disabled plugins
   keep their stored position.
4. **Split contract.** Audit split props and `activate(..., { openInSplit })`
   for pointer, keyboard, modifier-click, pane-cap, and compact behavior.
5. **Scope.** Decide whether the hook should work outside the sidebar (for
   example in a command palette plugin) or stay sidebar-only.
6. **Accessibility.** Validate labels, `aria-current`, shortcut metadata,
   disabled and loading state, and focus order in third-party markup.

## `app.slots.experimental_sidebarHeader` (`@get-bb/plugin-sdk/app`)

An exclusive, opt-in slot. The user picks a provider through
`sidebar.headerProvider`, and it renders one component in the sidebar header
row between the toggle and the history buttons. The component receives
`width`, `controlSize` and `isCompactViewport`.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Exclusive versus shared.** Confirm one provider is right for the header
   row, or whether several small controls should share it the way the sidebar
   footer does.
2. **Two pickers.** A plugin that wants its navigation in the header needs
   both its header and its navigation picked, which plugins do for the user
   from `bb.onInstall`. Decide whether that write should become a declared,
   host-applied default, or whether a navigation registration should declare
   a paired header instead.
3. **Geometry.** Validate `width` and the start inset across macOS with and
   without traffic lights, browsers, compact drawers, landscape safe areas,
   and a sidebar narrower than one control.
4. **Focus order.** Confirm header controls before the history buttons is
   acceptable when a plugin splits one list of items across the header and
   the navigation region.
5. **Drag regions.** Confirm the interactive-descendant no-drag rule covers
   real plugin markup, including custom elements and menus.

## `app.slots.experimental_threadList` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** Only examples use it. No shipped consumer
has tested the arbitration/fallback model or the accessibility contract.

An exclusive slot that replaces the sidebar's scrolling thread list. bb's own
list is the bundled `thread-list` plugin. Automatic selection prefers another
registered list, and the user can pin one with `sidebar.threadListProvider`.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned, with installed lists preferred
   over the bundled one, is the right long-term selection model and
   alphabetical plugin-id order is an acceptable default tie-breaker when
   multiple replacements are enabled.
2. **Fallback discoverability.** Confirm one toast plus the placeholder's
   Reload button is the right signal when the list crashes.
3. **Region boundary.** The plugin gets the scrolling list and nothing else:
   the New-thread button, search action, plugin nav rows, and footer stay
   host-rendered. Confirm no real sidebar needs to claim more, and that
   passing those regions down as props (letting a plugin place them, at the
   risk of dropping them) stays the wrong trade.
4. **Search compatibility.** Confirm released plugins no longer need the
   required deprecated `searchQuery` field before removing it in a deliberate
   breaking change. Until then, the host supplies `""`.
5. **Accessibility.** Confirm the host can still guarantee list semantics,
   focus order, and the mobile close behavior when a plugin owns the markup;
   `onNavigate` is currently the plugin's responsibility to call.

## AI services (`bb.experimental_aiServices.register`)

Registers `{ id, displayName, complete?, transcribe?, status? }`. `complete`
serves thread titles and commit messages, `transcribe` serves voice input,
and `status` feeds pickers and Automatic. The user selects per task
(`automatic`, `off`, or `{ pluginId, serviceId }`), and an explicit pick
never falls through to another service.

Docs: `backend-cli-agents.md`, [provider-plugin-api.md](provider-plugin-api.md) §7.

**Audit before stabilizing.**

1. **Structured input.** Confirm a bare prompt string stays enough, or whether
   services need the task (title vs commit) or a length hint without breaking
   the "plugin owns the model" split.
2. **Status freshness.** The picker and the microphone can show a status up
   to 10 s stale, and a task past that age waits up to 2 s for a fresh one; a
   plugin whose readiness flips (sign-in, quota) might want to push a change
   instead of waiting for the next poll.
3. **Voice payloads.** `transcribe` receives the whole `File` in process
   (25 MB cap). Decide whether streaming matters for long recordings.
4. **Automatic order as policy.** Core prioritizes bb cloud, then sorts
   by plugin id and service id, including third-party plugins. Decide whether
   this order and automatic inclusion should become user-editable settings.
5. **Several services per plugin.** Confirm the id-per-registration shape and
   the per-plugin id scope (plugin id plus service id).

## `PluginFileOpenerSource.experimental_hostId` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** It is persisted in opener-tab `paramsJson`,
so a rename needs a read-compat shim. Items 3–4 decide whether the stable name
is `hostId?` or a required field.

Names the explicit host for a project-backed workspace file that a file opener
cannot route through a thread or environment. It is omitted for the other
source kinds and for the primary host.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. Confirm an explicit host id is the minimum missing project-routing context,
   rather than exposing the whole project workspace routing union.
2. Verify project-compose file tabs retain the selected host across reloads,
   host changes, plugin fallback, and per-open viewer overrides.
3. Decide whether host identity should be present for every source kind or
   remain project-specific once more file opener plugins exercise the API.
4. Confirm omission should continue to mean primary-host resolution, that this
   remains compatible with persisted opener tabs created before the field
   existed, and whether it can become a stable required `hostId` without
   breaking older opener implementations.

## `experimental_VoiceInputTextarea` (`@get-bb/plugin-sdk/app`)

**What it does.** A host-owned controlled textarea with bb's voice input. It
takes `value`, `onValueChange`, and an optional `onVoiceInputActiveChange`;
every other textarea attribute, including `ref` and `className`, reaches the
underlying `<textarea>`. The caller styles the textarea; the host wraps it in
a relative container and, when the browser supports voice input, adds bottom
padding and the microphone, waveform, cancel, and stop controls. Finished
transcripts are appended to `value` through `onValueChange` and stay editable;
nothing is submitted. `onVoiceInputActiveChange` is true from the start of
recording until transcription finishes or is cancelled, and false on unmount,
so a form can hold navigation and submission. Unmounting discards late
transcripts. It uses the same microphone preference, transcription service,
and error handling as the prompt box. Without voice support it renders the
plain textarea; the test harness renders that plain textarea too.

The registry's `voice-input-textarea` item re-exports it, and the registry's
`question-form` renders its free-text answer with it. Inside bb, the built-in
Ask User Question and pi plugins and bb's own question form reach the same
component through the `@bb/shared-ui/voice-input-textarea` module the build
shims.

**Audit before stabilizing.**

1. **Prop surface.** Every textarea attribute passes through. Decide whether a
   narrower explicit list is the better contract, and whether callers need to
   style the host's wrapper (it is a plain block today, so a flex child cannot
   stretch it).
2. **Voice lifecycle.** Verify cancellation, microphone permissions, mobile
   capture, and late transcription isolation when the component unmounts or
   its `value` changes mid-transcription.
3. **Unsupported hosts.** The textarea renders without controls when voice is
   unsupported, with no reason shown. Decide whether callers need the
   unsupported reason or a way to hide the controls.
4. **Consumer count.** One form (the shared question form, used by Ask User
   Question, pi, and bb's own questions). Confirm a third-party consumer before
   the prefix drops.

## `experimental_SourceCode` / `experimental_Diff` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** It has one consumer (the github plugin's
`Diff`), and items 2–4 all change the prop surface.

Host-owned renderers for supplied code. `experimental_SourceCode` takes text
and a path. `experimental_Diff` takes a single-file patch, a path and
optional `experimental_fullFileContents` (`{ old, new }`). They are the same
components bb's own surfaces use, so an active renderer replacement covers
both.

Docs: `frontend-components.md`.

Decided (Aug 2026): context expansion takes caller-resolved contents, not a
loader callback.

**Audit before stabilizing.**

1. **Prop surface.** Confirm content + path + presentation plus optional full
   diff sides is the right minimal contract, and decide whether `className`
   belongs in it at all. A replacement never receives it, so a `className`
   that only styles bb's renderer is a quiet inconsistency.
2. **Diff input shape.** Confirm single-file patch text is the right currency.
   Multi-file patches, pre-parsed input, and per-hunk rendering are all things
   callers have wanted; none are expressible now.
3. **Language selection.** Highlighting is inferred from `path` only. Confirm
   an explicit language override is not needed before the names freeze, and
   that no implementation-library language union leaks in when it is added.
4. **Worker pool.** Thread panes and plugin nav panels provide bb's
   highlighting worker pool; homepage and settings sections do not, so a diff
   rendered there is unhighlighted. Decide whether the host should provide the
   pool at the component instead of the surface.
5. **Selection to chat.** bb's own surfaces pass a selection-to-composer
   handler that the public component withholds. Confirm plugins should reach
   that through `useComposer()` rather than a renderer prop.
6. **Size and virtualization.** Neither component caps input size or
   virtualizes. Audit against a plugin that renders a very large file or patch.

## `app.slots.experimental_sourceCodeRenderer` / `app.slots.experimental_diffRenderer` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no registrations, and "two slots
or one" changes the registration shape.

Exclusive slots that replace bb's source or diff renderer everywhere it draws
supplied content, including other plugins' calls to the public components.
Automatic selection uses the first registration in slot order, and the user
can pin bb's renderer or a provider per client. A crash falls back to bb's
renderer.

Docs: `frontend-renderer-slots.md`.

Decided (Aug 2026): the pin stays per client; a crash swaps back to bb's
renderer silently and disables the slot for the session; the replacement is
global, other plugins' surfaces included; replacements receive
`experimental_fullFileContents` like the public component.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned/built-in is the right long-term
   selection model. The two renderers pin independently; confirm users do not
   instead expect one "code rendering" choice.
2. **Global reach as precedent.** No other slot lets a plugin reach into
   another plugin's rendered output. Audit that before it is copied.
3. **Capability parity.** Selection-to-chat and the deleted-file gate remain
   host-only. Confirm that asymmetry is acceptable, or promote either
   capability before stabilization.
4. **Two slots or one.** Confirm source and diff should stay separately
   replaceable rather than one "code renderer" registration.

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no consumers. Items 4 (a
paged/windowed read at 10k threads) and 5 (the draft indicator gap) cannot be
resolved without one, and both change the contract.

The read hook returns the sidebar's live thread view (`PluginSidebarThread`
DTOs with a host-resolved `indicator`, plus `sections`) from the host's own
query and cache. The action hook routes to the host's own mutations. Neither
doc covers three September 2026 additions:

- `experimental_lifecycles` (active, archived, or both; active by default).
  With it, `PluginSidebarThreadsState.experimental_archived` exposes archive
  loading/error state, pagination flags and `fetchNextPage`; it is null for
  active-only reads.
- `PluginSidebarThreadsState.experimental_hosts`, the current machines in host
  query order, including those with no threads. Older hosts may omit it.
- `openNewThread({ hostId })`, unprefixed by request, preselects a machine for
  a new environment. `environmentId` takes priority.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **DTO scope.** Confirm every field earns its place and that the copy stays
   worth its maintenance over `ThreadListEntry`. `hasUnsubmittedDraft` is
   deliberately absent (client-local composer state); confirm plugins do not
   need it. `status` and `runtimeStatus` freeze the domain enums into the
   contract the way `indicator` does, under the same treat-unknown-as-fallback
   rule. `host` is resolved to `{ id, name }`; confirm resolution belongs here
   rather than in a separate hosts hook, and that falling back to the id for an
   unknown host is the right failure.
2. **Indicator coupling.** `indicator` freezes bb's precedence into the
   contract. Confirm new kinds can ship without breaking plugins, and that the
   documented "treat unknown as none" rule is enough.
3. **Unread semantics.** `isUnread` is plain read state, so it is true for
   child threads and running threads that `isUnreadDoneThread` excludes by
   design. Confirm that is the more useful primitive for a replaced list.
4. **Scale.** Confirm one array of every thread is right at ten thousand
   threads, versus a paged or windowed read. Unchanged threads keep their DTO
   identity across refetches, but the host does not cap the array and plugin
   lists are expected to window their rows. Decide whether that expectation
   should be enforced by the contract before stabilizing.
5. **Draft indicators.** `indicator` never reports "draft" or "working-draft",
   so an idle unread thread holding a draft reads as "unread-success" where
   the built-in row paints "draft". Decide whether to close that gap (a
   per-thread draft hook) or keep it documented.
6. **Sections.** Section writes are plain public API calls rather than
   actions. Confirm that split holds once a replaced list ships section
   drag-and-drop, where the built-in list's optimistic cache transactions have
   no plugin equivalent. `openNewThread`'s `sectionId`, `environmentId` and
   `hostId` ride on router state; confirm that stays the right transport, and
   audit the `hostId` selection semantics.
7. **Action surface.** `archive` closes panes and repairs the route, and
   `requestDelete` opens bb's confirmation. Confirm that split (silent
   `rename`, host-confirmed delete) is the right line, and decide whether bulk
   actions and undo belong here.
8. **Permission.** Decide whether `archive` and `requestDelete` need any plugin
   permission gate beyond installation trust.
9. **`experimental_useSidebarThreadPullRequest`.** A per-row, opt-in PR lookup
   sharing the host's environment-keyed query. It exposes normalized
   `experimental_autoMerge`, `experimental_inMergeQueue` (null means the queue
   lookup failed), `experimental_checks`, `experimental_review` and
   `experimental_mergeability`. Confirm the state summaries and unknown-queue
   semantics meet sidebar needs, that a sidebar of many distinct worktrees
   does not stampede the git host, and that returning `null` for "lookup
   failed" is the right failure for a row that should simply show nothing.
10. **`experimental_useSidebarThreadSplit`.** Gives a custom row the built-in
    drag-to-split gesture, with every layout rule owned by the host. Confirm a
    list with its own pointer-drag (reorder, swipe) still composes with the
    host's engage threshold; that `splitProps` staying an open object is the
    right forward-compatible shape, or whether it should narrow to a named
    handler; and that exposing the full `panes` array does not leak more
    layout state than a row needs.
11. **Archive selection and machine list.** Audit archive-only
    loading/errors, combined views, pagination retries, and archived row
    actions. Audit empty machine sections, machine removal, rename updates, and
    loading behavior for `experimental_hosts`.

## `app.slots.experimental_threadHeaderAction` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no consumers, and item 1 (merging
with `bb.ui.registerThreadAction`) is cheapest to decide before the first one.

Renders a plugin component in the thread header's action row, once per pane
with that pane's `threadId`, for controls that draw live state. A crash
removes only that pane's control.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Two APIs, one region.** `bb.ui.registerThreadAction` and this slot share a
   row. Confirm the ordering rule between them, and whether the two should
   merge behind one registration.
2. **Budget.** The row is short and already holds five host controls. Decide a
   cap, or an overflow behavior, before three plugins each add one.
3. **Compact viewport.** `isCompactViewport` asks every plugin to collapse
   itself. Confirm that beats a host-owned overflow menu.
4. **Per-pane mounting.** Confirm plugins handle mounting once per pane, and
   that a popover opened in one pane cannot leak into another.
5. **Height discipline.** The host clamps the control's layout box
   (`max-h-7 max-w-64`) but deliberately does not clip overflow, because
   clipping also hides an anchored popover. A plugin can therefore still paint
   outside the row. Decide whether that trade is right, or whether the host
   should require a portal.
6. **Other headers.** Decide whether the compose screen, plugin panels, and the
   workspace header need the same slot, or stay host-only.
7. **Crash isolation.** Each pane's mount has its own crashed-instance key, so
   one pane's crash does not disable another's copy; the thread-list slot
   deliberately does not, so a crash there disables it everywhere. Confirm
   that split, and decide whether other multi-mount slots need the same
   treatment.

## `app.slots.experimental_browserToolbarAction` (`@get-bb/plugin-sdk/app`)

Renders a plugin component beside the address bar in each Browser tab. It
receives `threadId`, `tabId`, `url` and a compact-viewport hint, with a crash
boundary per tab mount.

Docs: `frontend-registration.md`.

**Audit before stabilizing.** Confirm the toolbar can hold multiple plugin
controls without crowding the address field, whether ordering needs a user
preference, and whether plugins need browser instance or environment identity
instead of resolving it server-side from the thread and tab ids.

## `ExperimentalPluginBrowserToolbarActionProps.experimental_page` (`@get-bb/plugin-sdk/app`)

Gives a Browser toolbar action script access to its tab's top-level document
without a CDP lease. `evaluate(expression, { world })` runs in the main world
or bb's isolated world, where `bb.postMessage` reaches the calling plugin's
`onMessage` listeners. The value is `null` outside the desktop app.

Docs: `frontend-registration.md`.

**Audit before stabilizing.** Decide whether any enabled plugin may evaluate in
personal-profile tabs or whether this needs a user gesture, capability grant,
or origin allowlist. Plugins share one isolated world, so a plugin can post on
another plugin's channel; decide whether per-plugin worlds are required.
Confirm message size and rate bounds, subframe support, behavior during
navigation and renderer crashes, whether `evaluate` should time out while a
page is still loading, and whether an SDK or `bb` CLI surface is needed for
automation outside the toolbar component.

## `PluginMentionProviderRegistration.resolve().experimental_images` (`@get-bb/plugin-sdk`)

Lets a mention provider resolve a picked mention to agent-only image inputs,
each optionally preceded by a short agent-only text input. The images are
validated like ordinary prompt images before dispatch.

Docs: `backend-ui-lifecycle.md`.

**Audit before stabilizing.** Confirm images are the only binary input mention
providers need, the 50-image boundary is appropriate, and local image access
should remain governed by the thread dispatch validator rather than an earlier
plugin-specific check.

## Composer API redesign: final names without the experimental prefix

Michael decided to ship these under final names as an explicit exception to
the experimental-prefix rule, so plugin authors migrate once.
`useComposer()` returns one stable handle per composer. `removeMention`,
`onSubmitted`, `submit` and `setSelection` replace their `experimental_`
names, along with `ComposerCustomization.sendMenu`,
`PluginMessageActionContext.composer`, and `useComposers()`. Replaced members
are `@internal`: stripped from published declarations but still exported and
implemented at runtime.

Docs: `frontend-hooks-and-ui.md`.

**Audit.**

1. **Handle semantics.** A stable handle with reactive getters means memo
   dependencies must name fields (`composer.draft`), not the handle. Confirm
   the lint and documentation guidance is enough.
2. **Mention shape.** `ComposerMention` exposes core resource fields (path
   source and entry kind, command source and origin). Confirm these are
   stable enough to be public.
3. **Canonical pill text.** `insert` writes the editor's canonical pill text
   (`@label` for plugin mentions), while `insertMention` keeps writing the
   bare label. Decide whether `insertMention` should converge.
4. **Message-action composers.** They have no slot lifecycle, so
   `setTextEffect` and `setInputLock` warn and do nothing there, and
   `useComposers()` handles behave the same way. Confirm.
5. **Runtime-only aliases.** Decide when, if ever, the runtime drops the
   `@internal` names.
6. **Composer list order and membership.** `useComposers()` orders by mount
   and omits the sent-message editor. Decide whether panels also need the
   last-focused composer to pick a default target.

## Composer mention removal and successful submission subscriptions

`PluginComposerApi.removeMention({ provider, id })` removes the calling
plugin's matching mentions from the unsent draft.
`PluginComposerApi.onSubmitted(listener)` observes successful local
thread-send, queue-create and new-thread-create mutations in the composer's
scope. It is a local UI notification, not a server event.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, audit handoff scope routing, decide whether to include
the submitted structured draft in notifications to distinguish annotations
created while a request is pending, and verify disposal, failure restoration,
mention rebasing, and callback failure isolation across every composer host.

## `useComposer().submit` and dispatch `experimental_submission`

`submit({ sendAt?, experimental_data? })` submits the on-screen draft exactly
as pressing Enter would, and rejects with a user-presentable reason when it
cannot. `experimental_data` reaches every `message.dispatch` hook on the
initial attempt as an `experimental_submission` envelope carrying the
submitting plugin's id. Core validates the data as JSON but neither persists
nor interprets it.

Docs: `frontend-hooks-and-ui.md`, `backend-events.md`.

**Audit before stabilizing.**

1. **Programmatic send authority.** `experimental_data` permits an immediate
   submission without `sendAt`. Confirm which composer customizations should
   receive that authority before stabilization.
2. **Editors that save instead of send.** The queued-message and sent-message
   editors and the route-draft fallback reject with "cannot submit
   programmatically". `isSubmittingBlocked` lets a row disable itself before a
   click; confirm whether those surfaces also need a distinct capability flag.
3. **Data visibility.** Every dispatch hook sees the envelope and its owner id,
   not only the plugin that submitted it. Confirm that dispatch hooks remain
   the right trust boundary for plugin-owned submission data.
4. **Freshness of `sendAt`.** The host rejects a non-future `sendAt` at call
   time, but the server accepts any non-negative timestamp and dispatches a
   past one at once. Decide whether the send/create routes should refuse a
   past `sendAt` outright.
5. **No submission identity is returned.** The method resolves with nothing, so
   a plugin cannot address the queued row it just created without listing the
   thread's queue. Confirm whether the queued message id belongs in the result.
6. **Plugin-hosted new-thread composers.** `sendAt` reaches a hosting plugin's
   `onSubmit` and must be forwarded, but the submission envelope is not part
   of `NewThreadRequest`, so another plugin's `experimental_data` can be lost
   there. Decide whether to expose a forwardable experimental field or reject
   data-bearing submissions there.

## `useComposer().setSelection`

`setSelection(selection)` sets a composer's pickers through the same handlers
the pickers call, so a plugin choice is indistinguishable from a hand-made
one. Fields the composer has no picker for are ignored. It resolves with the
composer's selection once values commit and the model catalog settles, or
after 15 s. `PluginComposerApi.selection` is the reactive read side. It is a
stable snapshot that re-renders consumers on picker changes, and it is `null`
for composers without pickers. Both are final-named under the composer API
exception.

Docs: `frontend-hooks-and-ui.md` (`setSelection`). No doc covers the
`selection` read.

**Audit before stabilizing.**

1. **Provenance.** A value set by a plugin in the new-thread composer is
   stored and reported exactly like a hand-picked one. Decide whether
   `executionInputSources` should carry a plugin source before a second
   consumer needs it.
2. **Timeout shape.** The bounded catalog wait resolves with the unsettled
   selection rather than rejecting. Confirm that is the right failure mode
   for a plugin that shows the result to the user.
3. **Provider inputs.** `environment.inputs` are not applied; the provider's
   inputs control keeps its own value. Decide whether the seed path's inputs
   handling should be reused here.
4. **Guard semantics after a project switch.** A call already in flight
   survives its own surface's unmount and resolves with the settled result.
   Confirm that is the behavior plugins expect, and whether the promise should
   also resolve early when the composer itself unmounts.
5. **Model-only thread changes.** A model change in a thread without a
   provider change sets the next turn's model in place, as the picker does.
   Confirm plugins do not expect it to start a handoff.
6. **Empty selections in the result.** `providerId` and `model` are omitted
   while nothing is selected and `environment` while nothing is submittable,
   which overloads "missing" with "no picker here". Decide whether the result
   should distinguish them.
7. **Selection read.** Audit snapshot identity across provider catalog
   reconciliation and off-screen composer lifetimes.

## Desktop browser control

`bb.sdk.experimental_desktopBrowsers` (`ExperimentalDesktopBrowsersArea` and
its `ExperimentalDesktopBrowser*` types) drives the desktop app's browser. It
provides explicit host/window/thread discovery, tab creation in the single bb
browser profile, and expiring control leases with scoped CDP connections. It
also provides capture, reveal, close and release, plus `subscribe`, which
polls tab state every two seconds and is not a lossless event log. Cookie
import from an installed browser uses `listImportSources` and `importCookies`.
Connection credentials stay private to workers on the browser host. The core
CLI is `bb browser`.

Before stabilization, audit control and cookie import authorization. Any
caller with server access can control tabs carrying the user's logins and copy
the desktop user's browser sessions into the bb profile. OS consent applies
only where the platform demands it: macOS Keychain for Chromium, Full Disk
Access for Safari, and none for Firefox or keyring-free Linux Chromium.
Decide whether control or import should require a desktop-side confirmation.
Also audit per-tab mutual exclusion and child-target scope, native popup
handling, debugger detachment, daemon/desktop disconnect and reconnect
generations, expiry and cancellation races, bounded screenshot bytes, and
cross-platform desktop startup. Cloud browsers and external provider
registration are outside this surface.

## Machine paths and environment cleanup

`bb.sdk.hosts.get({ hostId })` includes nullable `threadStorageRootPath` from
the machine's latest daemon session, without waking the machine (CLI:
`bb machine show`). `bb.sdk.environments.experimental_cleanup({ environmentId })`
requests removal of an unused provider-managed environment, overriding
retention and bypassing cleanup backoff. It rejects live threads and unmanaged
environments and succeeds for already-removed ones. Acceptance is not
completion: read the environment lifecycle fields for progress (CLI:
`bb environment cleanup`).

Before stabilization, audit path portability and session freshness after
machine re-enrollment, and cleanup retry behavior across unavailable
providers, concurrent attempts, and environments shared by archived and live
threads.

## Host process primitives (`@get-bb/plugin-sdk/host`)

`experimental_spawnPortableOutputProcess` spawns an output-only child process,
and `experimental_sanitizeInheritedChildProcessEnv`
(`ExperimentalSanitizeInheritedChildProcessEnvArgs`) filters the inherited
environment, for host-local plugin commands.

Before stabilization, audit command cancellation, inherited environment
filtering, and portable output handling for host-local plugin commands on
every supported OS.

## `TimelineOutputPreview.experimental_fullOutputAvailability` (`@get-bb/plugin-sdk`)

Says why a timeline row holds a preview instead of the full output, as
returned by `bb.sdk.threads.timeline`. `available` means a detail read can
still hydrate it. `detail-limit` means that read exceeded its byte budget.
`retention-expired` means the full value no longer exists.

**Audit before stabilizing.**

1. Confirm these three states remain complete if another output storage tier
   or hydration limit is introduced.
2. Confirm plugins need the storage-policy distinction rather than a simpler
   boolean indicating whether a detail read can succeed.
3. Verify old persisted previews and mixed-version clients still receive a
   deterministic state before making the field stable.

## Document Markdown (`MarkdownProps.experimental_document`)

The Markdown component accepts explicit `{ target, rootPath, threadId }`
document context. `target` is a workspace or thread-storage live-file
identity, and `rootPath` is its resolved root. Relative links and images
resolve from the document's directory within that root. Thread-storage targets
must name the same thread. Malformed context never falls back to the ambient
workspace. Omitting it keeps message routing.

Stabilize after plugin consumers verify nested paths, source identity, missing
files, containment and line locations.

## `PluginFileOpenerProps.experimental_lineRange` (`@get-bb/plugin-sdk/app`)

Passes the owning file tab's latest one-based, inclusive
`{ startLineNumber, endLineNumber }` range to its opener (`null` for no
requested navigation). Each targeted open supplies a new object, so openers
observe its identity.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. Verify first, changed, identical, and rapid targets across workspace, host,
   and thread-storage files, tab remounts, and server synchronization.
2. Validate the identity-based repeat signal with third-party openers and
   decide whether an explicit request sequence is needed before stabilization.
3. Confirm absent-target, inclusive selection, EOF clamping, column support,
   file-tree navigation, and unsaved-edit behavior with more editor consumers.
4. Verify older hosts omit the prop safely and older plugins ignore it; audit
   reload restoration and cross-client range updates under the existing tab
   policy.

## `bb.experimental_serverAccess.recheck`

Sends a payload-less system `config-changed` notification to connected
clients, so configuration re-reads every registered provider's availability.

Docs: `backend-machines.md`.

Stabilization requires proving that a recheck from an unregistered or disposed
plugin is inert, that a provider cannot use it to force repeated refreshes of
unrelated configuration, and that pairing, unpairing and credential rejection
each reach the Machines settings section without a manual reload.

## `bb.experimental_serverAccess.register`

Registers a server access provider: `availability` (optionally with a public
`serverUrl`), `acquire({ key, hostId, signal })` returning a grant
`{ id, serverUrl, headers? }` or `{ status: "failed", message }`, and
`release({ key, hostId, grantId })`. Machines attach the grant's headers to
enrollment and runtime traffic.

Docs: `backend-machines.md`.

Before stabilization, prove retry-safe acquire/release across process death,
credential privacy and revocation, explicit and automatic defaults, expired
codes, removal while a provider is unavailable, and both enrolment and runtime
traffic with independent direct and Connect consumers. Availability does not
prove reachability from a remote machine.

## Machine enrollment and bootstrap

`bb.experimental_machines.bootstrap` prepares enrollment through the
provider's `MachineExecutor` and waits for the daemon connection. Each call
issues a fresh single-use credential for the same durable host identity. The
supporting `MachineExecutorRequest`, `MachineExecutor`,
`MachineBootstrapRequest` and `MachineBootstrapApi` belong to the experimental
`PluginMachines`, so their unprefixed names do not mean they are stable.

Docs: `backend-machines.md`.

Stabilization requires independent Modal and SSH consumers. It requires
failure verification for expired credentials, concurrent retries, interrupted
exchange, cancellation, identity mismatch, and restored snapshots. It requires
an audit that credentials never enter resource data or logs. It must verify
cleanup of a checkpointed allocation before successful enrollment, including a
safe no-op uninstall when installation never began, and retry after partial
installation. Migration and live vendor verification remain part of the
integration release gate.

## Machine provider `reconcileCleanup`

A required callback on `PluginMachineProviderDefinition`, used only when no
resource checkpoint exists. It discovers and removes uncertain allocations by
the durable launch key and must never allocate or bootstrap. Experimental
through `bb.experimental_machines`.

Docs: `backend-machines.md`.

Stabilization requires crash/abort coverage before submission, after
submission but before checkpoint, eventual vendor discovery, and
access-release retry coverage for each shipped provider.

## Machine provider `ephemeral`

An optional boolean on `PluginMachineProviderDefinition`, false by default,
for disposable compute. After the last live thread and its machine launch are
gone, core requests removal regardless of environment retirement policy.

Docs: `backend-machines.md`.

Stabilization requires another compute provider and recovery coverage across
environment retirement, live-work races, provider unavailability, and repeated
removal failures.

## Project checkout ownership

The provider context's `projectCheckout.experimental_ownsPath` is a required
boolean whenever a checkout is present. It is true only for a checkout core
materialised at that exact path, derived from persisted source ownership and
never from caller inputs. Core's environment hook policy uses it to apply to
fresh machine clones and leave user-maintained attachments alone.

Audit ownership propagation and recovery before stabilizing.

## Coordinated machine maintenance

`bb.sdk.hosts.experimental_suspend({ hostId })` drains active work (bounded at
five minutes) and invokes the provider's suspend callback. It rejects with
`machine_busy` while a live launch, provisioning environment or checkout
preparation ties work to the host. Plugins own idle timing and preservation.

Docs: `backend-machines.md`, `backend-sdk.md`.

Stabilization requires interruption, checkpoint/restart, removal
serialization, failed drain, bounded drain and same-identity restore tests.

## Thread-sequence and terminal-input notifications

`experimental_thread.events` delivers `{ thread, sequence }`, coalesced to one
notification per thread per second. `experimental_terminal.input` delivers
`{ terminal }` after real user input is forwarded. Neither exposes contents.

Docs: `backend-events.md`.

Stabilization requires coalescing tests, live streaming/terminal
verification, current-status behavior, and review of event delivery overhead.

## Host deletion notifications

`experimental_host.deleted` delivers the removed host's public DTO once,
fire-and-forget. A plugin not loaded at removal never sees it, so it must
also reconcile against a 404 from `bb.sdk.hosts.get`.

Docs: `backend-events.md`.

Stabilization requires deciding whether hosts deserve their own event map
instead of `PluginThreadEventPayloads`, covering removal paths added later, and
a second consumer.

## `bb.experimental_machines.getResource`

`getResource(hostId)` returns core's persisted host resource JSON, or null when
the host or resource is absent. Any plugin can read it, following the host
access model. It makes no vendor observation, and callers parse the
provider-specific data.

Stabilization requires validating missing-resource semantics and use by
additional machine providers.

## Environment compositions

`bb.experimental_environments.register({ id, displayName, description, icon, machineProviderId, environmentProviderId })`
declares a new-machine environment option backed by one concrete environment
provider. It supplies no lifecycle callbacks or inputs.

Docs: `backend-machines.md`, `frontend-components.md`.

Stabilization requires UI/CLI parity, registration validation, pre-allocation
refusals, provisioning timeline coverage, clone-failure machine retention and
later project-checkout/worktree reuse.

## Experimental host SDK machine operations

`bb.sdk.hosts.experimental_create`, `experimental_getEnrollmentCommand`,
`experimental_listProviders`, `experimental_suspend`, `experimental_resume` and
`experimental_retryCleanup` have no unprefixed aliases.
`experimental_getEnrollmentCommand` serves the in-memory manual setup command
and expiry only while that host is creating. Completion, removal, expiry and
server restart drop the command, which never enters persisted progress or
transcripts.

Docs: `backend-machines.md`, `backend-sdk.md`.

Before stabilizing, verify creation cancellation through host removal,
same-host restoration, serialized removal, plugin callers and UI/CLI parity.
The enrollment command requires expiry/removal, credential authorization and
transcript-redaction coverage.

## Moving the server (`bb.sdk.experimental_server`, `hosts.experimental_deleteOldServerCopy`)

`experimental_server.checkMove({ targetHostId, serverUrl })` returns the
pre-move checklist (`ServerMoveCheckResponse`).
`startMove({ targetHostId, serverUrl, stopRunningWork: true, archiveExistingTargetServerData })`
freezes this server, copies its data to the target, starts the new server
there, switches machines over, and retires this process. `moveStatus()`
reports the active and last move. A move whose activation was never confirmed
reports `recovery_required` and keeps this server up and frozen. In direct
mode the status carries `destinationStatusUrl`. `cancelMove()` works until the
switch starts, and in `recovery_required` it rolls the switch back.
`export({ signal })` streams an unencrypted gzip archive with its `sha256`.
`hosts.experimental_deleteOldServerCopy({ hostId })` deletes the locked old
copy. All of them refuse machine credentials. Everything except status and
cancel requires the default-off `serverMove` experiment (403
`server_move_experiment_disabled`). CLI:
`bb server move|export|import|unlock|allow-connect|delete-old-copy|install-machine-service`.

Before stabilization, audit: authorization for plugin backends (`bb.sdk` runs
with owner access, so a plugin can export every secret or move the server);
the switch ordering against the bb connect tunnel and daemons that miss
`server.moved`; archive size limits and streaming memory use; cancellation
and failure recovery at every step, including a server restart mid-move;
behavior when the target runs a provider-managed machine; and whether
`startMove` should return immediately or expose progress through a durable
operation id instead of the in-memory status.

## `app.experimental_icons.register` and `experimental_Icon`

`app.experimental_icons.register({ name, component })` adds inline React
artwork to the shared app icon registry. Explicit registrations override
built-ins, and the first plugin id in lexical order wins collisions.
`experimental_Icon` renders a name with a `fallback` (default `Zap`).
Resolved explicit icon names win over plugin branding for per-item icons.

Docs: `frontend-components.md`.

Before stabilizing, audit component sizing and accessibility, fallback
behavior, collision precedence, whether per-registration disposal is needed
beyond the existing setup lifecycle, and compatibility for plugins vendoring
older Icon components. Verify icon precedence and load/unload fallback across
mentions, message actions, nav panels and fixed tabs, panel launchers and
their tabs, and legacy sidebar-footer actions.

## `experimental_ProviderIcon`

The shared frontend renderer for agent, machine and environment provider
artwork. It takes `providerKind`, `provider` and an optional `fallback`
(default `Code`), and resolves slot overrides, then the logo mask, the glyph,
and the fallback, without fetching.

Docs: `frontend-components.md`.

Stabilization: audit SDK prop ergonomics against all three provider kinds,
same-id isolation and legacy override fallback, asset-vs-glyph precedence,
cross-plugin overrides, reload/error/recursion behavior, accessibility and
theme rendering on desktop and mobile. Keep metadata fetching and plugin
branding separate from provider artwork resolution.

## `HostsArea.experimental_reconcile`

Explicitly reconciles a provider-managed machine with core's recorded state.
For a suspended machine it starts the provider's suspension operation and
returns HTTP 202; callers poll host status for completion. Active and
transitional states are left unchanged. Provider suspend and resume must be
idempotent. CLI: `bb machine reconcile`.

Validate concurrent resume/removal, failure reporting, long-running caller
behavior, and the scope of supported states before stabilizing this API.

## Lifecycle ownership on thread creation

`bb.sdk.threads.spawn` and `bb.sdk.threads.fork` accept
`lifecycleOwnerThreadId`, and thread responses expose its nullable value.
These are data fields on existing SDK methods, so they carry no prefix.

Audit before stabilization: immutable cross-project ownership, cross-host
cleanup, archive/delete retries, creation races, and preservation of existing
unowned threads.

## Environment provider existing-path selection

`PluginEnvironmentProviderDefinition.experimental_existingPath(inputs)` returns
an absolute path or null from parsed inputs, without mutating anything. On an
existing machine, a usable environment of that project at the path is reused
with its provider, ownership, resource and cleanup identity intact. An
unusable one is refused, and a missing one goes through normal creation.
Other projects' managed paths remain forbidden.

Stabilization requires lifecycle coverage for reuse, missing paths, cleanup in
progress, cross-project ownership, and concurrent creation before binding.

## Composer editing: `insert` and `replace`

Michael explicitly requested the final names `insert` and `replace`, an
exception to the experimental-prefix rule. `PluginComposerApi.replace` takes
an explicit `ComposerDraftReplacement` or a synchronous updater from the
latest `ComposerDraftSnapshot`, and never infers mention reconciliation.
`insert` inserts at the cursor or end. The legacy `setText`, `updateText`,
`clear`, `addQuote`, `insertMention` and `removeMention` are `@internal`
runtime-only methods.

Docs: `frontend-hooks-and-ui.md`.

Before stabilization, audit snapshot identity and updater failure/lifetime
behavior across mounted, offscreen, and ephemeral editors, replay of attachment
paths in their owning project, and migration of third-party text transforms to
explicit mention ranges. Decide whether command application merits a shared
public operation.

## Thread creation placement

`PluginSidebarThreadActions.openNewThread` accepts `experimental_placement`
(`{ sectionId: string | null, pinned: boolean }`), which overrides the legacy
section option. Omitting it clears prior composer placement and uses the
legacy section or the general list, unpinned. The composer sends this
placement with normal and scheduled creation.

Audit pinned groups, custom sections, project/machine groups, route
transitions, draft recovery, and third-party sidebar compatibility before
stabilizing this option.

## Provider discovery metadata

`package.json` → `bb.experimental_providers` statically declares
`{ kind, id, displayName }` provider identities before a plugin runs. Only
`kind: "agent"` is accepted. It keeps a disabled plugin's agents discoverable
in Settings → Providers, and grants no runtime capability. Add `"environment"`
or `"machine"` only together with a consumer.

Stabilize after validating first-install discovery, shared-plugin enablement,
dynamic provider removal, plugin upgrades, and duplicate-ID ownership behavior
with third-party providers.

## Global prompt history (`bb.sdk.experimental_promptHistory`)

`list({ cursor?, limit?, signal? })` returns `{ entries, nextCursor }`, every
accepted user prompt newest first, each with `id`, `createdAt`, `input`,
`projectId` and `threadId`. `limit` is a digit string (default 100, max 1000).
A page can be short while `nextCursor` is set, because unparseable rows are
skipped. The same route backs `bb prompt-history list`.

Before stabilization, audit whether `limit` should be a number, whether the cursor format needs versioning, whether project or thread filters belong on this call rather than on `projects.promptHistory` and `threads.promptHistory`, and whether skipped rows should fill the page.

## `ThreadChatMessageReference.experimental_messageSeq`

The message reference handed to `messageAction` runs, `ThreadChat` consumer
message actions, and prose selections carries the event sequence that recorded
the message. It is the `msg` value of a message link and the seq accepted by
`sdk.threads.message` and `bb thread log --message`, so a plugin can build or
resolve a message link without guessing. It equals `sourceSeqEnd` except for a
steer, which is recorded by its request and shown at its acceptance.
Stabilize once message links have shipped and the seq has stayed stable across
edit-and-rerun, forks and context clears, and decide whether `sourceSeqEnd`
should remain alongside it.

## `PluginSidebarThreadActions.experimental_archiveEnvironmentThreads`

Archives an environment's active thread trees through the host flow, including optimistic cache updates, pane cleanup, shared toast styling, and one ten-second Undo action. Undo restores only returned archived IDs, sequentially with lifecycle owners first. Archive failures show a host error toast and reject; Undo failures show a host error toast.

Stabilize after verifying group archive and Undo with descendants, already archived threads, split panes, navigation during the Undo window, and failure rollback across sidebar organization modes.
