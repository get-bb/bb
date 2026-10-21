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
authorization or dispatch.
`bb.sdk.plugins.experimental_discoverRpc({ pluginId?, method?, signal? })`
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

## Queued message edit holds

`bb.sdk.threads.queuedMessages.experimental_holdForEdit({ threadId, queuedMessageId })`
(`POST /threads/:id/queued-messages/:queuedMessageId/edit-hold`) holds a
queued row while someone edits it and returns `{ leaseMs }`. While the hold
is live, no automatic dispatch (idle drain, schedule, plugin recheck, host
reconnect, failed-retry) claims the row, and the idle drain also keeps the
drainable rows behind it queued; rows waiting on a schedule or plugin are not
held back, and explicit send-now still claims it. Calling again renews the
lease; an unrenewed hold lapses after `leaseMs` and the periodic sweep
dispatches the row. It answers 409 once a dispatch claimed the row and 404
for a missing row. Holding never changes `updatedAt`, so a pre-hold
`expectedUpdatedAt` stays valid; a successful `queuedMessages.update` clears
the hold. `experimental_releaseEditHold` (`DELETE`, same path) cancels
without saving and is a no-op for an unheld row; releasing or saving
re-attempts dispatch immediately. The app's inline editor holds on open,
renews every quarter lease, and releases on close. Any client may renew or
release a hold.

Before stabilization, audit whether holds need an owner token so two clients
editing the same row cannot release each other's hold, whether queue DTOs and
`bb thread queue list` should show that a row is being edited, and whether
the lease length suits throttled background tabs.

## Plugin cache pruning

`bb.sdk.plugins.experimental_pruneCache({ dryRun? })`
(`POST /plugins/cache/prune`) deletes cached git and npm plugin versions
under `<data>/plugins/cache` that no installed plugin uses and returns
`{ dryRun, removed, bytes }`; each removed entry has `pluginId` (null for an
unrecorded directory), `version`, `path`, and `bytes`, counting a shared
monorepo checkout once. It removes every non-active version regardless of
age and keeps active versions, versions a pending or restoring rollback
needs, directories containing or inside an installed plugin's root, and
in-flight staging directories. It runs under the plugin registration lock.
Removing a plugin deletes its cached versions at once, and a successful update
deletes replaced versions once activation stabilizes (its state snapshot
stays for the 7-day retention window). It backs `bb plugin prune [--dry-run]`
and the palette's Clean up plugin cache.

Before stabilization, audit whether the response should report
retained-but-unused sizes so a UI can show reclaimable space without a dry
run, and whether stale `.staging`, `.promoting`, and `.corrupt` directories
left by crashes should be collected too.

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
environment entries for each session and turn, and for model catalog listing
with a `null` thread and project. Each entry is a literal or a
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

`experimental_useSidebarThreadActions` and `PluginSidebarThreadActions`
(`@get-bb/plugin-sdk/app`), with the testing harness's `SidebarActionCall` /
`inspection.sidebarActionCalls`, are superseded by the thread action
registry, `useSdk().threads`, and `useBbNavigate().toThread` / `toCompose`;
`experimental_archiveEnvironmentThreads` moved to
`experimental_useArchiveEnvironmentThreads`. Like `useComposerView` they are
`@internal`: published declarations drop them, while the runtime keeps
implementing them for installed plugins. Nothing in this repository calls
them.

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

**Kept experimental (2026-08-22).** Five members remain, each with an open
question below. The kit grows with a consumer, not ahead of one.

`experimental_acpProviderBridge` is the generic Agent Client Protocol bridge a
plugin re-exports, backed by `packages/provider-bridge-acp` (the official
`@agentclientprotocol/sdk` transport, turns for agent-started work, slash
commands and session options as bb thread state, elicitation forms as
question cards, sign-in guidance from advertised auth methods). It launches
the agent named by `providerOptions.acpLaunchSpec` with the dialect named by
`acpDialect` in bridge options. `experimental_probeAcpAgent` asks an installed
agent for its `agentCapabilities`, and `experimental_acpAgentProbeSchema`
validates the answer across a host RPC boundary.
`experimental_acpLaunchSpecSchema` / `AcpLaunchSpec` is the launch spec the
bridge parses.

`experimental_registerAcpDialect` adds a dialect. A plugin calls it at module
load in its `bb.host` artifact with an `AcpDialect` and names the id as
`acpDialect` in its registration. Empty and built-in ids (`acp`, `cursor`,
`grok`, `omp`, `opencode`) throw, re-registering an id replaces it, and an
unregistered id resolves to the generic dialect. bb's own dialects resolve
through the same registry (`resolveAcpDialect`).

`@get-bb/plugin-sdk/provider-bridge/acp-next`, the subpath the kit was
previewed under (2026-10-09), re-exports this kit unchanged and is
deprecated. Each subpath is bundled with its own dialect registry, so a
plugin must import every member from one of them. Remove it at the next
major.

Docs: `providers.md` (ACP agents), `provider-bridge-api-index.md`. No doc
covers the probe or launch-spec contracts.

**Audit before stabilizing.** Decide what `probeAcpAgent` owes a caller.
Today it spawns the agent with a 10 s timeout, advertises the bridge's own
client capabilities, and answers `-32601` to anything the agent asks. Settle
whether the timeout, the client capabilities and the refusal are the caller's
to choose. Decide whether `AcpDialect` is the right shape for a third-party
agent: its hooks are optional and unversioned, so a new one is a silent
capability change for every dialect. Decide whether a dialect should be named
by value in the provider registration instead of by id. Settle whether the
bridge and its dialect registry should be a factory rather than a module
singleton before a host artifact needs two configured differently. For
`acpLaunchSpecSchema`, the shape is stored in the ACP plugin's `customAgents`
setting and in registrations' bridge options. A change therefore migrates
stored agents; decide what a plugin is owed when the spec grows a field.

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

## `bb.sdk.threads.experimental_listPluginMetadata`

`POST /threads/plugin-metadata` with `{ pluginId, threadIds }` (1–200 ids)
returns `{ threads: { threadId, metadata }[] }` for each thread holding that
plugin's namespace, archived and deleted threads included, in one indexed
query; threads without a namespace and corrupt namespaces are omitted. The
plugin-bound SDKs default `pluginId` to the caller. First caller:
push-notifications' Notifications thread action.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Route binding.** Any caller can read any plugin's namespace, as with
   the single-thread metadata routes. Decide whether plugin requests should
   carry an identity the routes can enforce.
2. **Batch size.** 200 ids per request; callers chunk. Revisit if the
   attributes layer replaces per-registration reads.

## `bb.sdk.threads.experimental_listAncestors`

`POST /threads/ancestors` with `{ threadIds }` (1–200 ids) returns
`{ threads: { threadId, ancestorIds }[] }`, parent first up to the root,
for every existing thread including archived and deleted ones, in one
recursive primary-key query. First caller: push-notifications, so a parent's
level follows the current tree.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Shape.** Decide whether callers also need each ancestor's thread
   (title, status) rather than only ids, and whether it should merge with
   `experimental_listDescendants` into one tree read.
2. **Batch size.** 200 ids per request; callers chunk, like
   `experimental_listPluginMetadata`.

## `bb.sdk.threads.experimental_listDescendants`

`POST /threads/descendants` with `{ threadIds, includeArchived?,
includeHidden? }` (1–200 ids) returns `{ threads: { threadId, descendantIds
}[] }` in breadth-first order for every existing, non-deleted thread.
Archived and hidden descendants are omitted unless flagged, matching
`threads.count`, but the walk passes through them; anything reachable only
through a deleted thread is omitted. One recursive query over
`threads_parent_idx`. First caller: push-notifications, which republishes a
subtree's levels when a thread's level or parent changes and on
`thread.unarchived`.

Docs: `backend-sdk.md`.

**Audit before stabilizing.**

1. **Shape.** Decide whether callers need the tree's edges (each
   descendant's parent) or thread fields rather than a flat id list, and
   whether it should merge with `experimental_listAncestors`.
2. **Size.** A subtree of live threads has no cap, and the query walks
   archived threads even when it omits them. Decide whether to page.
3. **Omitted threads.** Unlike `experimental_listAncestors`, deleted threads
   are always omitted and archived and hidden ones by default. Confirm that
   callers never need deleted ones. No event announces a hidden thread
   becoming visible, so a caller that skips hidden threads cannot refresh
   one when it appears; decide whether visibility changes need an event.

## `PluginSettingDescriptor.experimental_optionLabels`

A `type: "select"` descriptor record from option value to display label,
shown in the settings form. Stored values, defaults, `settings.get()` and
`bb plugin config` keep the option values, and labels for values outside
`options` are refused at define time. First consumer: push-notifications'
level settings.

Docs: `backend-foundation.md`.

**Audit before stabilizing.**

1. **Shape.** Decide between this parallel record and `options` accepting
   `{ value, label, description? }` objects; the object form keeps labels
   beside their values and makes per-option descriptions possible, but every
   reader of `options` (host policy, server contract, CLI, settings form) has
   to handle both forms.
2. **CLI.** `bb plugin config <id>` still lists raw option values, which is
   what `set` accepts; decide whether it should also print labels.

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

## `bb.server.internal_DO_NOT_USE_openTunnelIngress`

Internal to bb's own connect plugins (`connect`, `bb--connect-next`): the `internal_DO_NOT_USE_` prefix marks members that are not part of the plugin API, are not offered to third-party plugins, and may change or disappear in any release.

`internal_DO_NOT_USE_openTunnelIngress({ audience })` resolves to
`{ baseUrl, close() }` for a listener on `127.0.0.1` with an ephemeral port.
Every HTTP request and WebSocket upgrade on it must carry an
`x-bb-gate-assertion` (`@bb/tunnel-contract/next`) signed by the bb connect
next gate for `audience`, the request method and the exact path and query;
anything else gets a 401 JSON body `{ code: "gate_assertion_invalid", reason }`
and never reaches the app. A verified request loses every inbound
`x-bb-gate-*` header, gets `x-bb-gate-auth` (and the machine id or OAuth
grant headers) from the claims only, has Host and the public Origin rewritten
to the server's loopback origin, and is dispatched in-process into the same
app as `loopbackBaseUrl` (HTTP, `/ws`, plugin WebSockets). The ingress never
counts as a loopback caller. Gate keys come from `BB_CONNECT_GATE_KEYS_URL`.
Opening an audience again shares its listener; it stops, and drops its
WebSockets, when every handle closes. Handles close when the plugin is
disabled or unloaded.

Core callers: none. The Cloudflare bb connect path still replays requests to
the main loopback port; the `connect-next` plugin is the only caller.

Docs: `backend-foundation.md`; the request rules are in [connect-next.md](connect-next.md) (Server ingress).

**Audit before stabilizing.** Decide whether the Cloudflare tunnel client
moves onto the same ingress so core and both connect plugins share one path.
Decide whether `target` (share ports) belongs here or stays refused. Confirm
the audience should stay free-form or become a typed server id, and whether a
plugin may open audiences for servers other than its own.

## `bb.hosts.internal_DO_NOT_USE_setNextTunnels`, `internal_DO_NOT_USE_nextTunnelStatuses`, `internal_DO_NOT_USE_onNextTunnelStatusChange`

Internal to bb's own connect plugins (`connect`, `bb--connect-next`): the `internal_DO_NOT_USE_` prefix marks members that are not part of the plugin API, are not offered to third-party plugins, and may change or disappear in any release.

`internal_DO_NOT_USE_setNextTunnels(config | null)` turns bb connect next machine
tunnels on (an `InternalDoNotUsePluginNextTunnelConfig`,
`{ domain, server: { protocol, host, port } }`) or off. The server keeps one
config owned by the calling plugin (another plugin's non-null call throws
while it is set; a null call from a non-owner is a no-op), clears it when the
owner is disabled or uninstalled, and sends it as `connect-next.replace` (and
`connectNext` in the session-open response) to every connected daemon that
holds a bb connect machine credential and opened its session with protocol
247 or newer. A protocol-246 daemon is still accepted and only gets its
Cloudflare shares. Each daemon runs frpc with one proxy per port declared
through `declareSharedPorts` at `<label>--<port>.<domain>` while it shares at
least one port, and refuses a config whose domain is not its trusted
enrollment's base domain or `next.<base domain>`, or whose tunnel host is not
`tunnel.<domain>`, or that is not `wss` for an https enrollment, so a plugin
cannot send the machine credential elsewhere.
`internal_DO_NOT_USE_nextTunnelStatuses()` returns each connected daemon's last
`connect-next.status` report as `InternalDoNotUsePluginHostNextTunnelStatus`
(dropped when its session ends), and
`internal_DO_NOT_USE_onNextTunnelStatusChange(listener)` calls `listener` on any
change and returns an unsubscribe function that disposal also runs.

Core callers: none. Product policy (on or off, which domain) belongs to the
`connect-next` plugin, which calls all three; core's Cloudflare machine tunnel
needs no config because the daemon derives its gate from its enrollment.

Docs: `backend-foundation.md`; the wire and daemon behavior are in
[connect-next.md](connect-next.md) (Machine tunnels).

**Audit before stabilizing.** Decide whether the config should be per host
instead of global, whether the status should be pushed through `bb.realtime`
instead of a listener, and whether the compatibility window for protocol 246
can close (then `HOST_DAEMON_COMPATIBLE_PROTOCOL_VERSIONS` goes back to the
current version only). Decide whether the Cloudflare machine tunnel should
move onto the same frpc runner once next replaces it.

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

**Kept experimental (2026-08-22).** Windows/UNC paths were never verified.

`experimental_FileLink` and `experimental_openFilePreview` open explicit live
workspace, host and thread-storage file targets through the current surface's
shared file-tab controller. `experimental_openFileExternally` opens a target
in the client's preferred external app. The boolean results report host
acceptance, and malformed targets stay inert.

**Core callers.** `usePanelFiles` owns file opening on the thread view, New
thread screen, and plugin page: core's workspace, host, and storage opens and
`openFilePreview` build the same tab requests under one scope rule, which
`usePanelFiles.test.tsx` checks against every surface. Links route through
`usePanelBrowser` on every surface.

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

## Terminal navigation (`BbNavigate.experimental_openTerminal`)

Shows a terminal the plugin created with `useSdk().terminals.create` in the
current surface's terminal panel. A thread surface accepts only that thread's
terminals, the New thread screen only its current terminal scope, and a
plugin page any terminal. It resolves false for unknown or exited terminals
and surfaces without a terminal panel, and closing the tab closes the
terminal. Requested in #1132.

**Core callers.** This API calls `usePanelTerminals`'s `open`; core's Start
terminal row, the `terminal.open` shortcut, and terminal tab selection use
its `select` on every surface. `usePanelTerminals.test.tsx` runs one contract
table against the thread view, New thread screen, and plugin page.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. Decide whether plugins need tabs that hide without closing the terminal
   (#1132's `closeBehavior: "detach"`). Thread and New-thread surfaces derive
   tabs from live sessions, so this needs a hidden-session notion in panel
   state rather than a flag on the call.
2. Confirm the per-surface acceptance rules with a real consumer, including
   environment terminals opened from a thread view and host-path terminals
   whose cwd differs from the New thread screen's target.
3. Verify compact-viewport drawer reveal, split panes, and opening a terminal
   whose host is disconnected.
4. Decide whether a nav panel should also declare a default terminal scope so
   the native "+ Terminal" button follows the page's worktree.

## Host plugin foundation (`bb.hosts.experimental_client`, `ExperimentalHostClient.experimental_onWorkerExit`, `ExperimentalHostClient.experimental_onSignal`, `ExperimentalHostRpcContext.experimental_retainWorker`, `experimental_defineHostEntry`, `experimental_killProcessesWithCwdUnder`, `experimental_readProcessIdentity`, and `experimental_createHostEntryHarness`)

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
reaps processes working under any of the given directories before they are
deleted (the SDK still accepts the pre-0.6.27 `{ directory }` shape at
runtime), and `experimental_readProcessIdentity(pid)` returns
`{ command, startedAt }` so a caller can confirm a recorded PID before
signalling it.

Docs: `backend-foundation.md`, `testing.md`.

**Audit before stabilizing.**

1. **Process reap and identity.** Confirm
   `experimental_killProcessesWithCwdUnder`'s platform coverage (Linux
   `/proc`, macOS `lsof`) and whether the grace should be per call. Confirm
   `experimental_readProcessIdentity`'s start-time precision per platform and
   whether a combined verified-stop helper should replace it.
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

## `PluginNavPanelRegistration.experimental_useBadge`

**Added 2026-10-15 (SDK 0.6.53), replacing `experimental_sidebarAccessory`.**
One consumer: the Tasks plugin's open-task count.

A nav panel hook returning `ExperimentalBadge`
(`{ count?, text?, tone?, label }`) or `null`. `count` and `text` are
exclusive; `text` is at most 8 characters; `tone` is `neutral` (the default),
`warning`, or `critical`, and bb owns the colors. The sidebar navigation model
runs the hook once per registered panel in the plugin's slot scope and crash
boundary and hands the value to every navigation provider as `item.badge`.
The bundled Navigation plugin's Rail draws a count (capped at `9+`) or a dot
on the icon, and does not draw `text`; its Top list and More menu draw the count
(capped at `99+`), the text, or a dot. Both add `label` to the accessible name
and put a dot on More, in the strongest hidden tone, while a badged panel is
hidden there.

The fields follow the 30 bb-community plugins that drew
`experimental_sidebarAccessory` (October 2026): 12 drew one count, 8 several
numbers or a fraction, 5 a short status word, 3 a percentage, and 18 used
red, amber, or an accent color for state. A plugin that still passes
`experimental_sidebarAccessory` keeps loading; the field is dropped with a
warning. Remove that compatibility once released plugins have migrated.

Docs: `frontend-core-slots.md`.

**Audit before stabilizing.**

1. **Core parity.** Decide whether a core destination needs a badge and, if
   so, route it through the same `item.badge` path the Navigation plugin
   draws.
2. **Tone and text.** Confirm three tones and an 8-character `text` cover
   migrated plugins, including the six that drew several colored counts and
   now draw one badge.
3. **Hook lifetime.** The hook runs for every registered panel while the
   sidebar is mounted, including hidden ones. Confirm that cost is acceptable for
   plugins with expensive queries, or add visibility to the hook's inputs.
4. **More summary.** The More button's accessible name lists every hidden
   badge. Check that this stays usable with many badged hidden panels.

## `app.slots.experimental_sidebarNavigation` (`@get-bb/plugin-sdk/app`)

**Restored 2026-10-15 (SDK 0.6.53) with `placement`.** It was removed in
#5229 (0.46.0); the names are unchanged so plugins built before 0.46, such as
Compact Nav 0.1.x and Sidebar Sections, load again.

**What it does.** Draws the sidebar navigation: New thread, Search threads,
Plugins, Skills, Automations, plugin panels, and More, plus optional controls
in the sidebar header. Exclusive.
`sidebar.navigationProvider` picks the provider by plugin key: the bundled
Navigation plugin's `navigation/rail` or `navigation/top-list`, another
plugin's key, or `__automatic__` (the default: the first registered provider
from another plugin, else `navigation/rail`). Legacy `__builtin__` and
`navigation/navigation` read as `__automatic__`.

The registration declares `placement`, `rail` or `list` (the default). bb lays
the sidebar out from the placement before the provider renders, and keeps the
layout around it: for `rail`, a fixed-width column that stays when the sidebar
collapses and Settings at the bottom of the column; for `list`, the area
above the thread list, a Settings footer action,
Back to app rows on the Settings, Plugins, and Skills lists, and a collapse
that hides the whole sidebar. Both placements use the same framed macOS
window chrome on wide viewports, so changing placement does not move the
window controls, history controls, or the vertical position of Settings search.
The component receives `isCompactViewport`,
`placement`, and the deprecated `experimental_Original`, which renders the
Navigation plugin's provider for the same placement, or nothing when that
plugin is disabled.

The optional `headerComponent` renders in the sidebar header row while the
navigation is active. On wide macOS desktop windows, this row sits below the
window title bar; elsewhere it sits between the sidebar toggle and bb's back
and forward buttons. It receives `width`, `controlSize`,
and `isCompactViewport`. The host clips it to the row, keeps the macOS drag
region for non-interactive space, aligns it with the macOS window controls,
and on a crash draws the header of the Navigation plugin's provider for the
same placement, with one toast. It replaces the separate
`experimental_sidebarHeader` slot and its `sidebar.headerProvider` setting,
which let users pair a header with a navigation it did not belong to. That
slot remains as an untyped runtime alias: a plugin's header joins each of its
navigations that has no `headerComponent`.

Before plugin frontends settle, a pinned provider, or the provider Automatic
last chose, reserves the placement it last had and draws nothing until it
registers; Automatic with nothing remembered reserves the rail. Once
frontends settle, a missing pinned provider falls back like Automatic, and
with no provider at all the sidebar uses the list placement and says no
navigation plugin is enabled. A crashing provider is replaced by the
Navigation plugin's provider for its placement, with one toast.

**Core callers on the same path.** bb's Rail and Top list are the bundled,
default-enabled Navigation plugin (`plugins/navigation`), which is on the
forkable list. It registers both through this slot with no host-only API:
the host owns only the placement layout, Settings, the customize editor, and
the navigation model. Rail's header is its New thread button, registered as
`headerComponent`; it does not read the size props.

**Audit before stabilizing.**

1. **Placements.** Confirm two placements cover real providers, or whether a
   rail provider needs a declared width.
2. **Boundary.** Verify providers can express useful navigation without the
   drawer, thread list, footer, resize handle, Settings, or shortcuts.
3. **Arbitration.** Confirm Automatic preferring the first installed
   provider from another plugin over the bundled Rail is right, including
   when several are installed.
4. **Loading.** Confirm an empty region in the remembered placement, now
   also for the bundled Navigation plugin at every boot, is acceptable.
5. **Original.** Remove `experimental_Original` once released plugins stop
   rendering it.
6. **Header alias.** Remove the `experimental_sidebarHeader` alias once
   released plugins pass `headerComponent`.

## `experimental_useSidebarNavigation`, `experimental_useSidebarNavigationSplit`, `experimental_SidebarNavigationIcon` (`@get-bb/plugin-sdk/app`)

**Restored 2026-10-15 (SDK 0.6.53).**

**What it does.** `experimental_useSidebarNavigation()` returns
`{ items, activeItemId, isHomeActive, isShortcutModifierHeld, actions }` from
one model mounted above the sidebar. Items arrive in the user's saved order
with `isVisible`, `isLoading`, `pluginId`, shortcut metadata, and `badge` (the
panel's `experimental_useBadge` value). Plugins written before 0.46 that drew
the removed `experimental_Accessory` item field show no counts until they read
`badge`. Item ids are the keys stored in
`sidebar.pluginPanelOrder` and `sidebar.visiblePluginPanels`, and items keep
their identity while unchanged. `actions` covers
`activate(id, { target })`, `goHome({ target })`, `setVisible`,
`setOrder` (unknown
ids are dropped and omitted ids keep their relative order at the end),
`openCustomize()` (bb's editor in a popover beside the navigation, after open
menus close, returning focus to the opener), `openDetails`, and
`disablePlugin`. `target` is `current`, `split`, or `tab` and the host handles
the navigation: `split` opens or focuses a pane, replacing the focused pane
at the pane limit. It opens a browser tab instead when the destination cannot
be a pane, splitting is disabled, the viewport is compact, or no split layout
exists. `tab` always opens a browser tab. Both require a synchronous user
gesture. Home accepts `current` or `tab`, with `tab` opening the new thread
screen. `goHome()` without options navigates in place. The bundled Navigation
plugin requests `split` on Cmd/Ctrl-click; the host owns the fallback.
Search remains a command at every target. Native shells
retain their window-open policy.
Existing plugin bundles using `activate(id, { openInSplit })` map `true`
to `target: "split"` and `false` to `target: "current"`, using the same
fallback rules. The SDK types only accept `{ target }`, so rebuilt plugins
must migrate. An explicit `target` takes precedence.

Calls after the caller unmounts do nothing; outside the
sidebar the hook returns no items and inert actions.
`experimental_useSidebarNavigationSplit(id, options?)` mirrors
`experimental_useSidebarThreadSplit` and accepts `activation: "distance"` and
`onDragStart` for rows in menus. `experimental_SidebarNavigationIcon` renders
bb's glyphs and panel icons with plugin branding as fallback.

**Core callers on the same path.** The bundled Navigation plugin's Rail, Top
list, and header New thread button use these hooks; the app's Settings →
Appearance → Navigation picker reads the same registrations.

**Audit before stabilizing.**

1. **Semantic items.** Confirm the action and icon variants cover current
   navigation without exposing routes or host elements.
2. **Home.** Confirm `isHomeActive` and `goHome({ target })` are the
   right Home contract for rail providers, including after Settings closes the
   compact drawer.
3. **Order semantics.** Confirm `setOrder`'s partial-order rule works for
   drag-and-drop providers.
4. **Accessibility.** Validate labels, badges in accessible names,
   `aria-current`, shortcut metadata, and focus return from Customize in
   third-party markup.

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
2. **Tokenizer, not a parser.** A dependency-free tokenizer skips comments,
   strings, template literals, regular expressions, and JSX text, then reads
   `import`/`export … from` declarations and `import()`/`require()` calls that
   are not property accesses or method definitions. Lexing is heuristic where
   JavaScript is ambiguous without a grammar: a `/` after `)` is read as
   division, and a `<` in a `.tsx` expression position is tried as JSX and
   falls back when no closing tag matches. Decide whether a full parser is
   owed before the scan is a promise.

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

## `app.experimental_copyToClipboard` (`@get-bb/plugin-sdk/app`)

A plain function, `({ text, html? }) => Promise<boolean>`, over the writer
bb's own copy actions use: bb Desktop's native clipboard, then the Clipboard
API, then `execCommand("copy")`. It resolves true only once a path wrote the
content and never rejects. The test harness records writes in the most
recently rendered slot's `inspection.experimental_clipboardWrites` and
resolves with that slot's `experimental_copyToClipboard` render option
(default true).

**Core callers.** The export is `copyToClipboard` from
`apps/app/src/lib/clipboard.ts`. Core copies call it directly or through
`copyToClipboardWithToast` and `useClipboardCopy`: `CopyButton`, the message
action bar, file preview, terminal, and the Copy thread link thread action.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Content shape.** Only plain text and HTML are supported. bb's message
   copy also writes an image, through its own path with Android and browser
   variants. Decide whether images belong in this contract or stay core-only.
2. **Harness scoping.** The clipboard is global, so the harness routes writes
   to the most recently rendered slot. Confirm that is enough for tests that
   render several slots, and decide whether content-script tests need their
   own capture.
3. **Desktop bridge failures.** A rejected bridge write falls through to the
   browser paths, which can then fail for the reasons the bridge avoids.
   Confirm on Linux Wayland and X11 that the bridge write lands.
4. **Feedback.** Every caller pairs the result with a toast or a manual-copy
   fallback. Decide whether a shared toast helper belongs in the SDK.

## `app.experimental_saveFile` (`@get-bb/plugin-sdk/app`)

`experimental_saveFile({ fileName, url } | { fileName, blob })` starts a
download through the same function bb's own downloads use. It clicks a
temporary download anchor, using an object URL for a blob. The bb iOS shell
downloads through `WKDownload`, keeping the WebView's request context, then
presents the share sheet; file bytes and cookies do not cross the JavaScript
bridge. The promise resolves `started` once the link is clicked or `failed`,
with an error toast, if it could not start. Completion and share-sheet
cancellation are not reported. The test harness resolves `started` and records
nothing.

**Core callers.** The export is `saveFile` from `apps/app/src/lib/save-file.ts`,
which file preview downloads, chat attachment links in the native shell
(`ConversationAttachments`), and voice-input recording downloads call. The
Tasks plugin's attachment cards call the SDK export.

Docs: `frontend-hooks-and-ui.md`.

**Audit before stabilizing.**

1. **Outcome shape.** Decide whether callers need completion or cancellation
   beyond the browser-compatible `started` result.
2. **Android.** The native download implementation is iOS only. Decide on
   Android file sharing and browser-created blob download support.
3. **Harness inspection.** Decide whether the harness should record requests
   the way it records clipboard writes.
4. **Link helper.** Decide whether the repeated click handler belongs in a
   shared link component.

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
`NewThreadRequest` carrying every resolved selection (including
`sessionOptions` when the user changed a provider's agent option), and the plugin then
creates the thread with `bb.sdk.threads.spawn`, which owns filing and
attribution.

**Core callers.** The New thread screen (`RootComposeView`) renders the same
`apps/app/src/components/promptbox/NewThreadComposer.tsx`;
`PluginNewThreadComposer` adapts it for the SDK, and its round-trip tests
(`PluginNewThreadComposer.test.tsx`, `new-thread-environment-seed.test.ts`)
guard the seed mapping against the root composer's environment resolution.

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
   quick-create-project, the guided machine-setup dialog, and codex-version
   submit blocking are deliberately absent. Confirm
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
   the New-thread button, the navigation rail, and the footer stay
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
Automatic selection prefers a registration from a plugin the user installed
over one bundled with bb (such as Monaco), then the first in slot order, and
the user can pin bb's renderer or a provider per client. A crash falls back to bb's
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

## `app.slots.experimental_codeFenceRenderer` (`@get-bb/plugin-sdk/app`)

Renders fenced code blocks of the claimed `languages` in assistant and
nested-agent message Markdown, where `messageDirective` activates. The
component receives `{ code, language, status, index, message, Original }`,
mounts once per fence, and survives streaming: the host owns the instance and
portals it to a placeholder keyed by the fence's source offset, keeping
iframes alive where `Element.moveBefore` exists. Contested languages, a
missing plugin, and a throwing fence fall back to `Original`. The harness
exposes `loadPluginApp(...).codeFenceRenderers`.

**Core callers.** `MarkdownPreview`'s code renderer
(`markdown-code-fence-renderers.tsx`), the pipeline that also resolves
`messageDirective`, hosts every claimed fence; the built-in `inline-vis`
plugin renders through it. BB's `mermaid` diagram stays a core special case
inside `Original`, because it renders on every Markdown surface and this slot
is scoped to messages.

Docs: `frontend-renderer-slots.md`, `testing.md`.

**Audit before stabilizing.**

1. **Collision model.** Confirm that a contested language falling back to
   BB's code block is enough, or whether users need a per-language picker
   like the source/diff renderer pin.
2. **Streaming contract.** Confirm `code`/`status`/`index` cover real
   generative-UI renderers (partial JSON/DSL parsing), and whether the rest
   of the info string should be exposed as `meta`.
3. **Scope.** Confirm the slot should stay limited to assistant and
   nested-agent Markdown, whether common languages (`json`, `ts`) should be
   claimable, and whether `mermaid` should be claimable or reserved for BB.
4. **Identity.** Confirm keying a fence by source offset holds for every
   path that rewrites a message's text, and decide whether iframes must
   survive the tail-to-settled move in browsers without `moveBefore`.
5. **Source visibility.** Decide whether BB should offer its own "view
   source" control for claimed fences instead of leaving it to each plugin.

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

**Kept experimental (2026-08-22).** There are no consumers. Items 4 (a
paged/windowed read at 10k threads) and 5 (the draft indicator gap) cannot be
resolved without one, and both change the contract.

The read hook returns the sidebar's live thread view (`PluginSidebarThread`
DTOs with a host-resolved `indicator`, plus `sections`) from the host's own
query and cache. The action hook is `@internal` and scheduled for removal
(see Scheduled removals). Neither
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
7. **`experimental_useSidebarThreadPullRequest`.** A per-row, opt-in PR lookup
   sharing the host's environment-keyed query. It exposes normalized
   `experimental_autoMerge`, `experimental_inMergeQueue` (null means the queue
   lookup failed), `experimental_checks`, `experimental_review` and
   `experimental_mergeability`. Confirm the state summaries and unknown-queue
   semantics meet sidebar needs, that a sidebar of many distinct worktrees
   does not stampede the git host, and that returning `null` for "lookup
   failed" is the right failure for a row that should simply show nothing.
8. **`experimental_useSidebarThreadSplit`.** Gives a custom row the built-in
   drag-to-split gesture, with every layout rule owned by the host. Confirm a
   list with its own pointer-drag (reorder, swipe) still composes with the
   host's engage threshold; that `splitProps` staying an open object is the
   right forward-compatible shape, or whether it should narrow to a named
   handler; and that exposing the full `panes` array does not leak more
   layout state than a row needs.
9. **Archive selection and machine list.** Audit archive-only
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

## `app.slots.experimental_threadAction` / `experimental_useThreadActions` / `experimental_useThreadActionRegistrations` / `experimental_ThreadActionsMenu` / `experimental_ThreadActionsContextMenu` / `experimental_THREAD_ACTION_GROUPS` (`@get-bb/plugin-sdk/app`)

A registration is `{ id, title, icon, group, order?, useData?, item }`.
`useData` runs once per registration for the whole app and receives
`{ threadIds }`, every thread a visible surface evaluates actions for,
debounced (32 ms quiet, 100 ms max). `item` is a pure function of
`{ thread, data, sdk, navigate }` returning a `PluginThreadAction` or null;
throws drop the registration or that thread's item, and `run` errors are
contained. Registrations sort by `group`, `order`, then registration order
for every menu and the quick-action picker. Thread-list registers Move to
section, and push-notifications registers Notifications. The SDK test fake
throws when a menu `trigger` drops its props and ref.

**Core callers.** bb's own actions are `CORE_THREAD_ACTIONS`
(`apps/app/src/lib/thread-actions/core-thread-actions.ts`), registered under
the reserved `bb--core` owner. The header menu (`ThreadDetailView` →
`ThreadDetailHeader`), `RootComposeMobileRecents`, and
`ThreadArchiveCommandHandler` read the same registry, and the thread list's
row menus and quick actions use the SDK exports. The contract table in
`ThreadActionsMenu.test.tsx` runs every menu surface against the same
registrations.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Per-thread data.** `threadIds` makes each registration fetch and cache
   per-thread state itself. Decide whether a host attributes layer should
   batch those reads across registrations, and whether `useData` should move
   onto `experimental_useRpcQuery`.
2. **Picker catalog.** The row-actions picker lists every registration,
   including actions that rarely make sense as row buttons (Delete, New thread
   in environment). Decide whether a registration should opt out.
3. **Run input.** `requestRename` is the only surface-supplied capability.
   Confirm no second one is needed before stabilizing the run signature.
4. **Inline items.** `inline` exists for surface-specific entries that are not
   about a thread. Confirm it should stay a component prop rather than a
   registration.

## `experimental_useArchiveEnvironmentThreads` (`@get-bb/plugin-sdk/app`)

Returns `(environmentId) => Promise<void>`, core's environment-group archive:
the optimistic `environments.archiveThreads`, split-pane cleanup, route
repair, and one ten-second Undo toast that unarchives the returned ids
(lifecycle owners first) and returns to the route. Failures show a host error
toast, and archive failures reject. It replaces
`PluginSidebarThreadActions.experimental_archiveEnvironmentThreads`. The test
harness records calls in `inspection.experimental_environmentArchiveCalls`.

**Core callers.** The hook returns `ThreadActionsProvider`'s
`archiveEnvironmentThreads`, bb's only environment-group archive, which the
deprecated sidebar-actions shim also calls. Its one caller is the built-in
thread list's environment group menu.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Scope.** A per-flow hook was the smallest honest path. If more host UI
   flows need exposing (thread archive and delete outside a menu), decide
   whether they become thread actions, bound-SDK side effects, or a small
   flows area instead of one hook each.
2. **Undo route repair.** The toast's route restore assumes the user has not
   navigated since; confirm that matches plugin-hosted surfaces.
3. **Coverage.** Verify group archive and Undo with descendants, already
   archived threads, split panes, navigation during the Undo window, and
   failure rollback across sidebar organization modes.

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
   source and entry kind, command source and origin, and the stored path an
   `attachment` mention shares with a file attached to the same draft).
   Confirm these are stable enough to be public.
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

`submit({ experimental_mode?, sendAt?, experimental_data? })` submits the
draft through the on-screen composer's own queue or steer handler and rejects
with a user-presentable reason when it cannot. It requires a draft: where the
shortcut would steer the next queued message from an empty draft, `submit`
rejects instead. Without a mode it runs whichever one
Enter runs for this user; `"queue-if-active"` and `"steer-if-active"`, the
names `bb.sdk.threads.send` uses, pick one explicitly, and
`"steer-if-active"` starts a turn where the composer has nothing to steer. The
options combine: `sendAt` and the plugin data travel into the same send,
queue or steer request the shortcuts build, so a scheduled steer steers the
turn running at its time. `experimental_data` reaches every `message.dispatch`
hook on the initial attempt as an `experimental_submission` envelope carrying
the submitting plugin's id. Core validates the data as JSON but neither
persists nor interprets it.

There is one implementation. `PromptBoxInternal` publishes `submit` on the
composer editor bridge; it picks Enter's handler, the queue handler or the
steer handler and gates it exactly as the matching shortcut is gated, then
calls the same `onSubmit` or `onModifierSubmit` the shortcuts and the send
button call, passing `sendAt` and the plugin submission. Only hosts that set
`sendsOnEnter` (the thread, embedded thread chat and New thread composers)
accept it. Off-screen voice sends run
the same Enter action. Every form rejects when the send fails; the Enter
action still shows its toast, and Enter and the send button ignore the
rejection.

Docs: `frontend-hooks-and-ui.md`, `backend-events.md`.

**Audit before stabilizing.**

1. **Programmatic send authority.** `experimental_data` permits an immediate
   submission without `sendAt`. Confirm which composer customizations should
   receive that authority before stabilization.
2. **Editors that save instead of send.** The queued-message and sent-message
   editors reject with "cannot submit programmatically". `isSubmittingBlocked`
   lets a row disable itself before a click; confirm whether those surfaces
   should run their own Enter action (save the edit) instead, and whether a
   plugin needs a capability flag to tell them apart.
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
7. **Two queue routes.** While Enter queues, a plain submit creates the queued
   row directly, as Enter does, so dispatch hooks first see it when the row
   drains. With `sendAt` or `experimental_data` it sends with
   `queue-if-active`, so the hooks run at submit time and again on the drain;
   only that inline pass carries the data. Both routes deliver into a running
   turn once its main run is idle. Decide whether Enter itself should queue
   through `queue-if-active`.
8. **Steering a queued message.** `submit` never steers the next queued
   message. Add an explicit operation for it when a plugin needs one.
9. **Scheduled submits without a mode.** `submit({ sendAt })` follows
   Enter, so it schedules a steer for users whose Enter steers. Confirm a
   caller that schedules should be required to pick a mode.

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
`bb environment cleanup`). After five failed attempts, automatic removal stops
with a "Needs recovery" message in the existing lifecycle fields.
The additive `recover: true` option acknowledges interrupted hooks and retries
failed cleanup after an explicit inspection. Core's cleanup route and the CLI
use this same path. Linux checks cwd and mapped paths for processes owned by
the daemon UID and refuses unreadable processes; other users require separate
inspection. Unsupported platforms refuse workspace recovery. Provider resources
without an owned workspace can restart removal without acknowledging any hooks.
No processes are killed by the inspection. Durable automatic recovery is tracked in #5962.

Before stabilization, audit path portability and session freshness after
machine re-enrollment, and cleanup retry behavior across unavailable
providers, concurrent attempts, and environments shared by archived and live
threads.

## Workspace diff Viewed state (`bb.sdk.environments.experimental_diffViewed`, `experimental_markDiffViewed`, `experimental_clearDiffViewed`)

`GET /environments/:id/diff/viewed` (diff target in the query) lists
`{ files: { path, revision }[] }` for one environment and diff target.
`PUT` with `{ target, path, revision }` marks a file Viewed at a revision, and
`DELETE` with `{ target, path? }` clears one file or the whole target; both
return `{ ok: true }` and emit the `diff-viewed-changed` environment change.
`POST` accepts the diff query fields and `paths` (up to 500) for a bounded
lookup; an empty list returns no records. The SDK selects this path when
`experimental_diffViewed` receives `paths`. Core uses the loaded diff paths,
independent of display filters, so marking Viewed cannot hide its own query.
Records live in `diff_viewed_files`, keyed by environment, target
(`uncommitted`, `commit:<sha>`, `branch_committed:<branch>`, `all:<branch>`)
and path. Revisions come from the `revision` field that `diffFiles` now
returns for every file: `<oldMode>:<oldBlob>:<newMode>:<newBlob>` from
`git diff --raw`, with the worktree side hashed by `git hash-object`. A file
counts as Viewed only while the stored revision equals the current one.
`diffFiles` and `diffPatch` also accept `ignoreWhitespace` (git `-w`).

Core callers: the workspace diff panel's Viewed checkbox
(`DiffFilesPanel` through `useSetDiffFileViewed` and
`useEnvironmentDiffViewed`) and `bb environment diff-viewed list|mark|unmark|clear`.

**Audit before stabilizing.**

1. **Revision cost.** Every file list hashes each changed worktree file; check
   latency on large diffs and very large files, and whether git's index stat
   cache can supply unchanged blobs.
2. **Retention.** Records for destroyed environments stay until the row is
   deleted; decide whether destroy should clear them.
3. **Shape.** Decide whether the file list should carry `viewed` itself so
   callers do not join two reads.

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

## Thread parent-change notifications

`experimental_thread.parentChanged` delivers `{ thread,
previousParentThreadId }` after a `threads.update` moves or releases a
thread, or after core releases an archived thread's unarchived children (one
event each, after the archive commits). Threads below the moved one get no
event. Push-notifications uses it to republish the moved subtree's levels.

Docs: `backend-sdk.md`.

Stabilization requires deciding whether a general `thread.updated` event
should replace it, and a second consumer.

## Host deletion notifications

`experimental_host.deleted` delivers the removed host's public DTO once,
fire-and-forget. A plugin not loaded at removal never sees it, so it must
also reconcile against a 404 from `bb.sdk.hosts.get`.

Docs: `backend-events.md`.

Stabilization requires deciding whether hosts deserve their own event map
instead of `PluginThreadEventPayloads`, covering removal paths added later, and
a second consumer.

## Environment removal notification

`experimental_environment.removed` delivers `{ removal }` (environment id,
pre-removal host and path, provider ownership, removal time) after a
provider's removal is committed. Delivery is ephemeral, and provider success
does not guarantee the path was deleted.

Docs: `backend-events.md`.

Stabilization requires review of the payload fields, repeat-removal
semantics, notification timing, and recovery without guaranteed delivery.

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
`experimental_listProviders`, `experimental_reconnect`, `experimental_suspend`,
`experimental_resume` and `experimental_retryCleanup` have no unprefixed
aliases. `hosts.delete({ hostId, force: true })` is the path core's machine
removal dialog and `bb machine remove --force` use to finish a persistent
machine's removal whose environment cleanup failed while the machine is
disconnected; it skips on-machine environment cleanup, emits
`experimental_environment.removed` for each environment, and still runs the
provider's `remove`.
`experimental_getEnrollmentCommand` serves the in-memory manual setup command
and expiry only while that host is creating. Completion, removal, expiry and
server restart drop the command, which never enters persisted progress or
transcripts. `experimental_reconnect({ hostId })` returns
`{ command, windowsCommand, expiresAt, hostId }`, expiring commands that
re-enroll an existing machine.

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

## `experimental_ThreadStatusGlyph` (`@get-bb/plugin-sdk/app`)

Renders bb's thread status glyph from `PluginThreadStatusGlyphProps`
(`indicator`, `archived?`, `rowStatus`, `hideIdleDraftLabel`, `size`); the
host owns icons, colors, and labels, and the caller resolves the indicator.
The SDK test fake exposes the props as `data-*` attributes.

**Core callers.** `ThreadStatusGlyph`
(`apps/app/src/components/thread/ThreadStatusGlyph.tsx`) is the SDK export
and the glyph in the thread search palette, the related threads info section,
and mobile recents. The thread-list plugin draws its rows and collapsed-group
rollups with it.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Indicator resolution.** The caller resolves the indicator, so the
   thread-list plugin keeps its own copy of the indicator precedence and labels
   that `@bb/client-core` holds for bb's surfaces. Decide whether the SDK should
   export the resolver and labels instead.
2. **Archived rows.** No plugin passes `archived` yet; confirm the archived
   glyph belongs on this component rather than in the archived list.

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
`projectId`, `threadId`, and `scope` (`"project"` for a prompt that started
a top-level thread, `"thread"` for a follow-up). `limit` is a digit string (default 100, max 1000).
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

## `PluginBbSdk.plugins.experimental_startUpdate` and `experimental_updateJobs`

Starts a server-owned plugin update and returns its job at once;
`experimental_updateJobs.list/get` report queued/running phases and the
terminal update, rollback, or failure. Jobs survive client disconnects, stay
ten minutes after finishing, and live in memory only. `applyUpdate` keeps its
result contract by polling the job; raw callers without
`Prefer: respond-async` keep the synchronous response. Running updates cannot
be cancelled during activation or rollback.

Stabilization requires exercising reconnect/reload, concurrent deduplication,
rollback delivery, missing jobs after restart, and CLI/SDK parity.

## `PluginBbSdk.system.experimental_recordTelemetryEvent`

Posts one anonymous product event to `POST /api/v1/system/telemetry/events`,
which forwards it to usage telemetry under the install's anonymous id and
drops it when usage data sharing is off. The schema is a strict allow-list of
setup-guide and new-thread-submit events; anything else is a 400. Core
callers, all through `recordTelemetryEvent` in
`apps/app/src/components/onboarding/onboarding-telemetry.ts`: the setup guide
(`OnboardingFlow`) and `NewThreadComposer`'s `new_thread_submit` outcomes.

Stabilize after deciding whether third-party plugins may emit product events
at all and, if so, how they are namespaced and rate limited.

## `PluginBbSdk.system.experimental_cliCommand`, `experimental_installCliCommand`, and `experimental_removeCliCommand`

`experimental_cliCommand()` reports whether `bb` is on PATH on the server's
computer: `supported` (false without an installed bb-app launcher),
`installedPath`, `onPath`, and `shadowedBy` (`source` `npm`, `machine`, or
`other`). Install links `<dataDir>/bin/bb` into a PATH folder (on Windows,
adds `<dataDir>\bin` to the user PATH) and refuses to replace another `bb`
(`409 cli_command_blocked`); install and remove return the new status, fail
with `409 cli_command_unsupported` when unsupported, and 403 for machine
credentials. Core callers: Settings → General → Command line
(`CliCommandSettingsSection`) and `bb settings cli-command`.

Stabilize after deciding whether the command should be installable per
machine through the host daemon (enrolled machines get `~/.local/bin/bb` from
`install-machine.sh` today), and after exercising real Windows and macOS
installs.

## `PluginBbSdk.hosts.experimental_discoverRepos`

`hosts.experimental_discoverRepos({ hostId })` lists up to 10 git
repositories under the machine's home directory with local activity in the
last 30 days, newest first, each with `path`, `name`, `lastActivityAt`,
`originUrl`, and the bound `projectId` or null; `truncated` reports an
exhausted three-second walk budget. The walk skips dot, build, and scratch
directories, linked worktrees, and submodules. Core callers: the setup guide
(`OnboardingFlow`) and `bb project discover`; it rides the
`host.discover_repos` daemon command.

Stabilize after deciding whether depth, recency window, and limit should be
caller options, and after exercising slow or network-mounted home directories
and Windows hosts.

## Shared VCS process admission (`@get-bb/plugin-sdk/host`)

`experimental_runVcsProcess(command, args, operation, options)` admits a `git`
or `gh` operation to the runtime's shared queue before invoking it. `args` are
the command's arguments; they classify git network subcommands (`fetch`,
`pull`, `push`, `clone`, `ls-remote`, `submodule update`, `remote update`).
Arguments without a network subcommand, including an empty list for pipelines,
admit to the local pool. The call holds the permit until the returned promise
settles; callers must await child close and termination cleanup. Calls nested
inside an admitted operation run under the outer permit without queueing again.
`ExperimentalVcsProcessOptions` accepts `priority` (`interactive`, `status`,
`background`), an optional cancellation signal, and `slots` for pipelines
that start multiple git children. Queue cancellation prevents spawning; callers
own cancellation of running children. Execution timeouts begin after admission.

The runtime keeps two disjoint pools. The local pool admits
`clamp(os.availableParallelism() - 2, 4, 6)` local git children, computed once
per runtime: background work can fill two fewer slots and status work one
fewer, so eight or more cores give six, five, and four. The
network pool admits at most four network git or `gh` children, with at most two
`gh`: background work can fill two slots and status work three. Waiters gain one
priority level every 15 seconds. FIFO applies within effective priority in each
pool: when the first waiter that is not held back by the GitHub lane needs more
slots than its pool has free, later waiters in that pool wait behind it, so
pipelines are not starved by single-slot work. A blocked GitHub waiter does not
block eligible network git work, and neither pool blocks the other. The budget
is shared across module copies in one Node runtime, including bundled plugins.
Separate host daemons and server processes own separate budgets; arbitrary
commands run by agents or terminals are outside this queue.

Core buffered git/gh reads, streaming status/diff reads, blob reads, shell
pipelines, watcher setup, environment provisioning, and the GitHub plugin use
this path. The CLI and SDK's workspace reads and mutations reach the same host
handlers. Host commands give explicit user mutations and diff panels interactive
priority, status reads status priority, and PR polling/watcher setup/provisioning
background priority.

Before stabilization, audit cancellation and permit release on all supported
platforms, mixed plugin bundles sharing the singleton, aging under sustained
load, whether the CPU-scaled local capacity needs a host override and reflects
container CPU quotas on supported hosts, whether argument
classification should cover more network commands (for example `git lfs`), and
whether work that escapes an admitted operation's async context should regain
admission. Verify that every caller holds permits until its last admitted child
exits, including pipelines.

## Navigation-panel route sidebar

`PluginNavPanelRegistration.experimental_sidebar` is an optional component
receiving `PluginNavPanelProps`. `AppLayout` resolves one route sidebar per
location with `resolveRouteSidebar`: Settings, Plugins and Skills are core
entries, and a live navigation panel with `experimental_sidebar` is a plugin
entry. `AppLayoutSidebar` mounts whichever entry resolves in the alternate
sidebar body, holds the outgoing entry while a compact drawer closes, and
retains the native rail and mounted thread-list state. Every entry renders in
`SectionSidebar`, which owns the top chrome and history controls, the "Back to
app" row and title in the top-list layout, compact-drawer dismissal for SDK and
delegated-link navigation, and the resize handle. Panel sidebar routes are
section routes in `useAppSettingsRouteMemory`, so Back to app and the `app.back`
command return to the last core app route, as from Plugins and Skills. A crash
shows the plugin crash notice inside the section until the subPath or plugin
generation changes. Registration and route switching change no setting, thread,
draft or execution state.

Docs: Plugin Guide Full-page panels surface. Stabilization requires exact route,
back/forward, disable/reload/crash, compact focus and single-sidebar replay with
real plugin CSS in both navigation layouts. The API is generic; no plugin-id
special case exists in core. CLI navigation uses the existing panel URL; this
field introduces no separate backend or headless side effect.

## Plugin contract live reads and writes

- `experimental_useRpcQuery`, `experimental_useRpcKeyedQuery`, `experimental_useRpcMutation`, and `experimental_useRpcRefresh` use the core `@bb/query-tags` cache mechanism per client. Query state keeps previous data during refresh errors; consumers show an inline Retry using `refetch`. Successful reads clear the error. Keyed calls accept `{ keys }` and return a record containing every requested key; consumers share one observer per plugin/method and requests batch up to 200 keys. A pure `select` projection retains unchanged JSON subobjects across key and fetch-state changes, so default rows do not republish unchanged notification levels.
- `ExperimentalRpcMutationState.pendingInputs` contains every in-flight input for that hook instance until the server acknowledges its write. Background rereads are excluded. `isPending` remains true while any input is pending. Core `useTaggedMutation` exposes the same state from TanStack's mutation cache. Stabilization requires hook-instance isolation, concurrent targets, failure cleanup, and pending feedback surviving row moves between groups.
- `ExperimentalRpcMutationOptions.optimistic(input, cache)` predicts loaded cached values before the write. `cache.update(method, input, updater)` targets a plain read, and `cache.updateKey(method, key, updater)` targets one keyed row. `cache` is an `ExperimentalRpcOptimisticCache`. Pure updaters receive the currently visible value and return its prediction. An absent plain read is skipped; a keyed row that loads while the write is pending shows the prediction. Predictions are shared by every reader on that client. The core route mutation accepts the same core optimistic descriptors and uses the same `@bb/query-tags` implementation. Ui-preferences already updates its shared Jotai atoms optimistically, which remains unchanged.
- Predictions remain over incoming reads until confirmed matched reads arrive, independently of mutation pending state. A rejected write rolls back its layer and surfaces the mutation error. An accepted write whose refresh fails keeps its prediction with the read error and Retry; a successful refresh replaces it. Later predictions and confirmed values are protected from older mutation settles and rollbacks. Inverted completion retains the later confirmed value until a subsequent fresh read can replace it. Keyed rows live in the `@bb/query-tags` keyed store: an accepted row prediction becomes the row's value, and only a read of that row that started after acceptance replaces it. Stabilization includes overlapping writes, external invalidation, refresh failures, plain/keyed targets and completion without stale flicker.
- `defineRpcContract` accepts the core `ContractTagDeclarations`: `tags(input, output)`, `keyTags(key, value)`, and `invalidates(input, output)` receive validated values. Tags are in the RPC envelope; successful writes broadcast their invalidated tags and return `invalidated`. Tagged mutations resolve at write acknowledgement while matching active reads refresh in the background.
- `bb.rpc.experimental_invalidate(tags)` requires nonempty tags; `experimental_invalidateAll()` refreshes all reads of that plugin, including untagged reads. Load, reload, disable and reconnect refresh plugin reads through the same cache path. Plugin changed messages are scoped to `{ kind: "plugin", pluginId }` subscribers; reconnect batches subscriptions and unknown targets are ignored.
- Core uses the same tagged reads, invalidation and mutation implementation for UI preferences. Core keeps each thread once, in the same `@bb/query-tags` keyed store as plugin keyed rows, and derives thread detail, every thread list, search and sidebar navigation from it as keyed views. Every core thread write (pin and unpin through one batcher, read state, rename, section and parent moves, archive, unarchive, delete, stop, send status, environment rename) predicts on the entity with `optimisticKeyedUpdate` through `beginOptimisticMutation`, the path `cache.updateKey` uses, and confirms at the server's acknowledgement. One contract table (`@bb/query-tags/testing`) runs against core thread entities and plugin keyed rows; the pin hooks add `useTaggedMutation` with `meta.errorMessage` for core's error toast. Push-notifications thread levels are the first plugin caller; delivery retains `useRealtime`. Stabilization requires additional plugin callers and validation of scoped tags, failures, reconnects, batching and sidebar observer counts. Watching and cache seeding remain outside this API.

## Typed RPC refusals (`experimental_PluginRpcRefusal`)

- Handlers throw `new experimental_PluginRpcRefusal({ code, message, issues? })` from `@get-bb/plugin-sdk`. Codes map to HTTP statuses: `forbidden` 403, `not_found` 404, `conflict` 409, `invalid` 422. Issues use `PluginRpcValidationIssue[]`. The existing `{ ok: false, error: { code, message, issues? } }` envelope carries the refusal to app hooks, SDK calls and CLI errors.
- Refusals count as invocations, but do not increment handler errors or change plugin status detail. Ordinary throws remain `handler_error` / 500. Refused writes publish no invalidations and reject so shared optimistic updates roll back.
- Core caller: bb-account's connect-only credential RPC handlers use the same runtime, HTTP route and caller contract as third-party plugins. The fake host and `renderSlot` accept the same thrown refusal.
- Stabilize after validating caller-gated refusals and optional issue propagation across HTTP, app queries/mutations, SDK watches and CLI, including rollback and crash accounting. Watching is added by the next stack PR; its `onError` receives the SDK error carrying the refusal code.

## Plugin RPC contract and client-state guarantees

- All three live hooks use `{ contract, method, ... }` with contract/method inference and no explicit generic arguments. Plain reads add `input`, keyed reads add `keys` and optional `select`, and mutations add optional `optimistic`. `experimental_useRpcKeyedQuery({ contract, method, keys, select? })` infers rows and selection results from the contract value. `ExperimentalRpcKeyedMethod` restricts methods to schemas accepting only `{ keys: string[] }` plus optional/defaulted fields and returning string-indexed records; `ExperimentalRpcKeyedValue` derives their row values. `defineRpcContract` rejects `keyTags` unless parsed input has string keys and output is a string-indexed record. Push-notifications is the first caller. Stabilization includes transformed schemas, invalid shapes and projected selections.
- `experimental_PluginRpcCallError` is exported from the SDK root and app entry and is the error of live read/mutation hooks and every rejected `mutate`. It always has `code: PluginRpcErrorCode`, `message`, optional validated issues and optional HTTP status. `transport_error`, `invalid_response` and `unknown_error` cover client failures. The union may grow: consumers need a fallback; unknown server codes map to `unknown_error` and remain in `serverCode`. CLI output preserves newer codes without assuming an exhaustive list. Core callers use the same HTTP, SDK and command error boundaries; bb-account exercises expected refusals. Stabilize after version-skew, transport, malformed-response and refusal checks.
- `mutate`, `isPending` and `pendingInputs` finish at write acknowledgement. Core `runRouteMutation` has the same semantics through `runTaggedMutation`; ui-preferences saves the acknowledged revision independently of refresh completion. Cache predictions survive background refreshes and failed rereads until fresh confirmed data arrives. Write rejection rolls back. Owner tests cover acknowledgement, held refreshes, reconciliation and concurrent predictions.
- BB read state means: `data` is the latest successful value plus predictions, retained during refresh errors (plain reads start undefined; keyed selections receive loaded rows, initially an empty record). `isLoading` means an enabled read is fetching never-loaded requested data. `isFetching` includes background attempts; keyed views share method activity. `error` records the completed read failure and clears on success; retrying a first load clears its old error while loading. `refetch` forces a read and waits through retries; failure remains in `error` and its promise resolves. Production freshness is two seconds without polling. Focus does not refetch while BB's realtime connection is healthy; while disconnected, focus/browser-online events recheck stale active reads. BB reconnect invalidates all plugin reads regardless of freshness. Page hiding cancels active attempts and resume restarts cancelled reads. Invalidations refresh immediately. Tags remain plain strings. Network/abort failures retry twice with 250 ms delay, HTTP failures never retry, and writes never retry automatically. No query-library options are exposed.

## Page titles

`PluginNavPanelRegistration.experimental_usePageTitle(props)` returns
`ExperimentalPageTitle | null`: either `title` or
`breadcrumbs: { label, to? }[]`, with an optional `windowTitle` override.
The host calls this React hook in each pane's plugin scope with its own
`subPath`. Content appears after the panel icon/name. Breadcrumb links must
be absolute app routes starting with a single slash. The focused pane supplies
the window title, defaulting to the leaf/title combined with the panel name.
Null restores defaults. A title hook failure clears the title without crashing
the body; navigation and plugin reload retry it. The host isolates hook
lifecycles by pane, route and plugin generation.

Core Tools, Skills and Plugins use the same hook host and title provider;
Automations registers its own hook and shares its detail query with the body.
The Plugin Guide full-page panels card owns the API documentation.
`renderSlot` evaluates the registered hook in its slot scope and exposes its
current result as `RenderedSlotInspectionState.experimental_pageTitle`;
audit test-host lifecycle parity before stabilization.
Before stabilization, audit focus changes, same-plugin splits, loading,
back/forward navigation, crash/reload recovery, links and overflow.
