# APIs To Audit

Every public plugin API member ships with an `experimental_` prefix and an
entry here (see [AGENTS.md](../AGENTS.md), "Plugin API"). Dropping the prefix
is the deliberate stabilization step: audit the entry, rename project-wide,
and delete the entry in the same change.

## `experimental_buildBridgeToolCallContent`

**What it does.** Converts a decoded bb tool-call response into the ordered
text and inline-image content blocks accepted by MCP and Pi tool result
contracts. It preserves a legacy aggregate text/images input while first-party
bridges migrate to ordered `contentBlocks`.

**Audit before stabilizing.** Confirm that MCP and Pi continue sharing this
content-block vocabulary; decide whether legacy aggregate fields still need to
be accepted; and define any image MIME validation, decoding, or payload-size
policy at the server boundary before making the helper stable.

## Bridge record mode (`experimental_recordProviderChildIo` and `experimental_isProviderBridgeRecording`)

**What it does.** `experimental_recordProviderChildIo` tees a provider
child's stdio into the bridge record mode (`BB_PROVIDER_BRIDGE_RECORD_DIR`),
scoped to the bb thread the child serves. It is a no-op when record mode is
off, so a bridge calls it unconditionally after `spawn()`.
`experimental_isProviderBridgeRecording` reports whether record mode is on,
for a bridge whose provider pipe is owned by an SDK and must take the spawn
over to tee it. See [provider-bridge-protocol.md](provider-bridge-protocol.md),
"Record mode".

**Audit before stabilizing.** Decide whether the bridge kit should own the
spawn itself (one helper that spawns and records) instead of a post-spawn
hook; confirm the `{ threadId | null }` scope is the right key once bridges
multiplex several threads over one child; and settle the recording entry
shape (`{ ts, run, seq, dir, line }`) as a documented fixture format.

## Provider bridge maintenance (`PluginProviderCapabilities.experimental_providerHealth`, `PluginProviderCapabilities.experimental_providerUsage`, `PluginProviderCapabilities.experimental_providerInstallation`, `ProviderInfo.experimental_providerHealth`, `ProviderInfo.experimental_providerUsage`, `ProviderInfo.experimental_providerInstallation`, `BRIDGE_REQUEST_METHODS.experimentalProviderHealth`, `BRIDGE_REQUEST_METHODS.experimentalProviderUsage`, `BRIDGE_REQUEST_METHODS.experimentalProviderInstallationStatus`, `BRIDGE_REQUEST_METHODS.experimentalProviderInstallationRun`, `experimental_providerMaintenanceParamsSchema`, `experimental_providerHealthSchema`, `experimental_providerHealthResultSchema`, `experimental_providerUsageSchema`, `experimental_providerUsageWindowSchema`, `experimental_providerUsageResultSchema`, and the `experimental_providerInstallation*` schemas/types)

**What it does.** Adds optional, sessionless `provider/health`,
`provider/usage`, `provider/installation/status`, and
`provider/installation/run` requests to provider bridges. Each provider
declares support at registration so the server can skip unsupported host probes
and clients can omit unsupported maintenance surfaces before starting a bridge.
Health reports cheap host-local readiness; usage reports provider-normalized
subscription windows. Installation status owns provider-specific discovery,
version/source detection, and whether an install or update is currently
available. Installation run resolves a fresh typed executable/argument plan
and post-run verification rule. Only its display command reaches product
clients; the daemon receives the executable plan and remains responsible for
host environment, working directory, concurrency, process supervision,
streaming, and verifying the resulting provider status. The maintenance
runtime supplies the provider id, working directory when one exists, and the
same provider-scoped launch options used by a real session. A status request
may also name a typed operation requirement such as `thread_rewind`; the
provider owns the minimum version for that requirement and reports the same
normalized `versionUnsupported` result consumed by generic core gating.

**Audit before stabilizing.** Confirm the readiness vocabulary covers API-only
and router providers, that health remains free of network usage/update checks,
that account metadata has appropriate privacy treatment, that installation
plans cannot smuggle host policy or unsafe execution through the typed boundary,
that verification rules cover native and package-manager update behavior, that
omitted fields from plugins built against the older experimental API continue
to mean false, whether the requirement vocabulary should remain one shared
enum, and that ACP's shared bridge can continue distinguishing built-in and
custom agents without exposing provider-specific launch or installation
details to clients.

## URL navigation (`experimental_UrlLink` and `BbNavigate.experimental_openUrl`)

**What it does.** Gives plugin UI the same semantic HTTP(S) opening path as
first-party UI. Ordinary activation respects the current client's in-app
browser preference and capability; app routes remain SPA navigation, modifier
clicks and explicit anchor targets remain browser-owned, and unsupported
schemes are left to the browser. New top-level targets preserve supplied `rel`
tokens but add `noopener noreferrer` unless `rel` explicitly contains
`opener`. The imperative method returns whether the current app accepted the
intent. The frontend harness records link and imperative calls through the same
navigation inspection log.

**Audit before stabilizing.**

1. Confirm HTTP(S)-only ownership and external fallback across desktop, web,
   remote clients, and windows whose current surface cannot host Browser.
2. Audit internal absolute and relative routes, fragments, modifier clicks,
   keyboard activation, explicit targets, copied hrefs, and accessible names.
3. Confirm the component should retain ordinary anchor props rather than a
   smaller styled-link contract, and that explicit `target` continues to mean
   browser behavior rather than BB preference routing while safe default `rel`
   values prevent implicit opener access.
4. Measure use across plugin pages, Settings sections, panel tabs, Markdown,
   and menus before stabilizing the boolean acceptance contract.
5. Keep the host implementation in the shell and verify plugin bundles contain
   only the runtime indirection, not BB browser or panel code.

## Live-file navigation (`experimental_FileLink`, `BbNavigate.experimental_openFilePreview`, `BbNavigate.experimental_openFileExternally`, and `PluginFileOpenerSource.experimental_hostId`)

**What it does.** Gives plugin UI explicit, source-safe references to live
workspace, host, and thread-storage files. Ordinary `experimental_FileLink`
activation and the preview method use the current surface's shared file-tab
controller, including extension preferences and plugin file openers. The
external method resolves the current client's preferred file target, absolute
path, local/remote-SSH context, and line/column support. The boolean methods
report host acceptance; later OS failures remain host-owned. The host id added
to file-opener sources preserves explicit host identity when a plugin page
opens a host file without ambient thread context. Valid link targets expose a
scheme-safe href, while traversal paths, ill-formed Unicode, and other
malformed runtime targets remain inert in both the app and SDK test runtime.

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
7. Confirm `PluginFileOpenerSource.experimental_hostId` can become a stable
   required `hostId` field without breaking older opener implementations.

## Host plugin foundation (`bb.hosts.experimental_client`, `ExperimentalHostClient.experimental_onWorkerExit`, `ExperimentalHostClient.experimental_onSignal`, `ExperimentalHostRpcContext.experimental_retainWorker`, `experimental_defineHostEntry`, and `experimental_createHostEntryHarness`)

**What it does.** Lets one plugin package declare a singular `bb.host` Node
entry, share a Standard Schema contract between its server and host entries,
and call methods on an explicit enrolled host. A client may observe unexpected
worker exits and typed, ephemeral host signals. The host context supplies
request and generation abort signals, persistent plugin-scoped data and
worker-scoped temporary directories, daemon-owned native file watches, and
explicit worker-retention leases for independent background work. Calls and
watches retain automatically; otherwise, the daemon gracefully evicts a worker
after five idle minutes and starts it again on the next call. There is no global
worker-count limit.

The single-worker, idle-eviction, retention, and call-timeout rules above are
specific to the host RPC consumer. Other daemon subsystems may attach the same
`bb.host` artifact through a different bootstrap and own their own process
lifecycle.

The initial builtin proof is Keep Awake: it owns a host target, a worker-owned
child process, desired-state reconciliation, and
unexpected-exit recovery without feature-specific core hooks.

**Audit before stabilizing.**

1. **Contract shape.** Confirm Standard Schema values remain the right runtime
   boundary and decide whether method-specific typed errors are necessary.
2. **Targeting.** Confirm explicit host ids are enough for V1 and add an
   environment-aware primitive only alongside a plugin that proves its
   locking and workspace semantics.
3. **Process lifetime.** Measure whether five idle minutes is the right timeout,
   whether watches should continue retaining automatically, and whether leases
   acquired only during active handlers are expressive enough. Confirm there is
   no need for manifest lifetime flags, plugin-selected timeouts, a global
   worker limit, or plugin-specific restart policy. Confirm unexpected-exit
   notification is the right generic repair trigger, remains suppressed for
   graceful and idle disposal, and does not create crash loops.
   Verify reconnect generation reconciliation covers disable/uninstall during
   an outage without stopping a still-current worker on every transient drop.
4. **Signals and watches.** Confirm host signals should remain private,
   ephemeral invalidations rather than a durable event log. Audit native-watch
   coalescing, backpressure, rescan/error events, per-worker limits, and cleanup
   against a plugin that watches real workspace state.
5. **Paths.** Confirm the stable host data path layout and generation-temporary
   cleanup behavior across crashes and daemon restarts.
6. **Limits.** Audit the common call duration, startup/cancellation grace, 8
   MiB JSON payload cap, 256 MiB artifact cap, and per-plugin admission limits
   (256 active calls / 32 MiB of active inputs) against real plugins. Confirm
   retaining only the most recently materialized artifact digest per plugin is
   sufficient.
7. **Environment.** Confirm executable discovery through normalized `PATH`
   and stripping all daemon-owned `BB_*` variables.
8. **Trust and dependencies.** V1 host plugins are trusted Node programs that
   may use `child_process`, filesystem, and network APIs. Decide whether later
   permissions, native artifacts, or an explicit dependency installer can be
   layered on without changing the RPC contract. Confirm rejecting all private
   `@bb/*` imports from host bundles is the correct permanent boundary, and
   audit the builder-supplied public SDK runtime against future host exports.
9. **Composition boundary.** Confirm host RPC methods and signals should remain
   private to the owning plugin while allowing another daemon subsystem to
   consume the same `bb.host` artifact through its own bootstrap and lifecycle.
10. **Test harness.** Audit both layers: the server harness's
    `experimental_callHostRpc` option, `experimental_hostRpcCalls` inspection
    list, `experimental_emitHostWorkerExit`, and `experimental_emitHostSignal`
    behavior drivers; and the host-entry harness's `experimental_call`,
    `experimental_getSignals`, `experimental_getRetainedWorkerLeaseCount`,
    `experimental_lifecycleSignal`, path/watch options, and
    `experimental_dispose`. Confirm the host harness should
    continue simulating validation, cancellation, lifecycle, JSON, and size
    limits without pretending to model process startup, crashes, native watcher
    recovery, or reconnect behavior.

## Fixed-tab navigation (`PluginNavPanelRegistration.experimental_fixedTabs`, `experimental_target`, `experimental_useAppPanel`, and `experimental_useFixedTabTarget`)

**What it does.** Lets a nav panel declare ordered, non-closable tabs in the
host-owned right panel. The host owns tab selection, persistence, chrome,
Browser and Terminal tools. One tab is active per visible split pane, so
multiple fixed-tab components can be mounted concurrently; a component mounts
only while active in a visible pane and the panel is open. A fixed tab receives
the nav page's current `subPath`; `layout: "padded"` uses
host padding and scrolling, while `layout: "flush"` gives the component the
whole content region. On the first visit the first declared fixed tab opens on
wide layouts. A later user close remains closed. Every fixed-tab registration
must include a `panelId` matching its containing nav panel and is also its
stable, plugin-owner-and-panel-scoped reference. `experimental_useAppPanel()`
can select one of the calling plugin's eligible tabs on the current surface
and optionally submit a JSON-safe target. The tab's `experimental_target`
validator owns the target type and policy; `experimental_useFixedTabTarget()`
returns the validated current-session value with a sequence and explicit
`clear()`. Tab selection stays durable. Each tab's target remains memory-only,
but survives inactive-tab, closed-panel, and route remounts until its owner
clears it or the app refreshes. Core Changes targets and plugin targets resolve
through the same feature-agnostic controller.

**Public surface.** `ExperimentalFixedTabTargetContract`,
`ExperimentalPluginFixedTabReference`,
`ExperimentalPluginFixedTabRegistration`,
`ExperimentalPluginFixedTabDeclaration`, `ExperimentalAppPanelSurface`,
`ExperimentalFixedTabTargetState`, `ExperimentalOpenFixedTabOptions`,
`ExperimentalAppPanel`, `experimental_useAppPanel`, and
`experimental_useFixedTabTarget`. The frontend testing runtime mirrors this
with `ExperimentalFixedTabOpenCall`, the
`experimental_openFixedTab`/`experimental_fixedTabTarget` render options, and
the `experimental_fixedTabOpenCalls` inspection list.

**Audit before stabilizing.**

1. Confirm first-visit opening and subsequent close persistence across plugin
   reloads, app upgrades, wide/compact transitions, and page deep links.
2. Exercise multiple fixed tabs and dynamic registration changes; selection
   must remain stable when possible and fall back without mounting components
   that are inactive in every visible pane.
3. Confirm `subPath` is sufficient context and that fixed tabs should remain
   page-scoped rather than gaining independent routes or plugin-owned state.
4. Audit padded versus flush layout against Tasks, Docs, accessibility zoom,
   and nested scrolling before freezing the presentation contract.
5. Confirm named icon hints and the non-closable tab treatment remain the right
   amount of plugin-controlled chrome.
6. Audit registration objects as references: identity is scoped to the mounted
   plugin and current nav panel, with no cross-plugin addressing or global ids.
7. Confirm sync type guards remain the right owner validation contract and
   define error reporting if a validator throws or becomes stale after reload.
8. Exercise repeated equal targets, explicit clearing, crashes, inactive-tab,
   panel, and route remounts, refresh, and compact drawer animation. Targets
   must survive remounts in the current app session, never survive refresh, and
   never reappear after their owner clears them.
9. Decide whether a future cross-thread surface should navigate before opening;
   the initial public surface intentionally supports only `{ kind: "current" }`.
10. Keep core and plugin destinations on the same resolver and verify the
    controller never learns Changes, file, task, or document target shapes.

## `PluginNavPanelRegistration.experimental_sidebarAccessory`

**What it does.** Lets a nav panel register a no-props, presentational React
component at the trailing edge of its host-rendered sidebar row. The component
can own an RPC query and realtime subscription, so a live count updates within
that subtree instead of lifting plugin state into the whole sidebar. The host
does not mount it on compact viewports. On wider viewports its layout box is
limited to one line at 4rem wide by 1.25rem high; overflow is clipped and
ordinary long text is ellipsized. It shares the trailing action column and
fades out for the host options button on row hover or keyboard focus without
unmounting. A crash hides only the accessory.

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

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and is
cleared automatically when that frontend generation deactivates.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration across plugins, frontend generations, and native thread
  statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal.

## `bb.agents.registerTool({ experimental_statusLabels })`

**What it does.** Lets a native plugin tool supply one short label while it is
pending and one after successful completion. BB snapshots the labels into the
tool-call event and renders them in its own timeline; a tool without the field
keeps the ordinary `Running tool …` / `Ran tool …` title. Approval, error, and
interruption states deliberately keep their standard titles so the raw tool
identity and failure state remain clear.

Each label is capped at 80 characters and rendered as a truncating segment.

**Audit before stabilizing.**

1. **Presentation scope.** Confirm two static labels cover enough real tool
   types, or introduce a deliberately bounded parameter interpolation API
   without letting plugin strings become arbitrary timeline markup.
2. **Lifecycle semantics.** Revisit whether failed or interrupted calls need
   a third explicit label, rather than reusing the generic fallback.
3. **Persistence and source identity.** Labels are snapshotted by the server
   only for non-MCP native plugin tools. Confirm that distinction stays sound
   as provider adapters and dynamic-tool provenance evolve.

## `bb.agents.registerTool({ experimental_presentation })`

**What it does.** Lets a native plugin tool declare how its calls read as a
timeline row in the grammar v3 vocabulary
([provider-plugin-api.md](provider-plugin-api.md) §3): a `label` pair
(pending/completed), an `icon` glyph, `suppress` for low-value rows clients
collapse by default, and an optional `tint`. The server resolves one full
presentation per injected tool at its boundary — the declaration, then
`experimental_statusLabels` for the label, then a generic `Running <name>` /
`Ran <name>` label and the owning plugin's branding glyph (or `Toolbox`) —
and hands it to the bridge on the tool definition. A bridge stamps it, beside
`server: "bb"`, on the `item.open`/`item.close` of every call to the tool, so
the persisted row carries its presentation and no core table of bb tool names
is needed.

**Audit before stabilizing.**

1. **Supersedes `experimental_statusLabels`.** The label pair is the same
   vocabulary; stabilize one field and delete the other in the same change.
2. **Per-call headline.** `title` and `detail` are per-call, not
   per-definition; decide whether a plugin may derive them from the call's
   arguments (a bounded interpolation) or whether the bridge always owns them.
3. **Glyph vocabulary.** The icon is a host glyph name; confirm the plugin
   branding glyph fallback reads well for multi-tool plugins, and whether a
   content-addressed asset form should be accepted once the persisted
   presentation supports it.

## `bb.providers.register` (and its `bb.agents.experimental_registerProvider` alias)

**What it does.** Lets a plugin declare an agent provider into the server's
`ProviderRegistryService`. The declaration owns static metadata and opaque
bridge options; executable behavior is the bridge the plugin exports from its
`bb.host` artifact. Registering without one (and without being a
daemon-bundled first-party id) fails the plugin load. The declaration is
validated at call time by the shared host policy
(`validatePluginProviderDeclaration`); registrations stage during the factory
and commit when the plugin load commits, are replaced wholesale on reload, and
are removed by the returned disposer or on unload/disable. Declarations are
the ONLY source of providers — the core catalog seed is deleted, so disabling
a provider plugin removes its provider. A registered provider is mapped onto
exactly one client shape, `ProviderInfo`, plus the backend-only
`ProviderServerCapabilities`, and appears in the composed provider listing
(`GET /system/providers` / execution options). `bb.providers` is the namespace
(`bb.agents` keeps `configure`, `registerTool`, `contributeInstructions`);
`bb.agents.experimental_registerProvider` is an alias kept for plugins
compiled against it and goes at stabilization.

Ids are flat and first-wins: a live id collision fails the later plugin's
load, and no id is reserved ahead of time (`RESERVED_PROVIDER_ID_OWNERS` is
gone). Listing order is plugin install order — bundled first-party plugins
rank first, in their bundled-list order, then every other plugin by install
time — under the user's `providerOrder` / `defaultProviderId` app settings
(`PRODUCT_PROVIDER_ORDER` and `PRODUCT_DEFAULT_PROVIDER_ID` are gone).
`experimental_visibility: "installed"` withholds a provider from unscoped
listings until its own `provider/health` result is not `not_installed`.
`experimental_bridgeOptions` is validated as bounded JSON, rides every daemon
bridge launch, participates in the runtime process key, and arrives at the
bridge as provider-scoped static options. Core does not interpret its keys.

**Audit before stabilizing.**

1. **Install-order ranking.** Bundled plugins rank by their position in
   `BUNDLED_PLUGINS`; other plugins by `installedAt`. Confirm that a
   reinstalled builtin (tombstone then reinstall) keeping its bundled rank is
   right, and that `installedAt` is the fact users expect for third-party
   order (vs. first-load time). The user overlay (`providerOrder`) is an
   ordered id list that ignores unknown ids; decide whether stale ids should
   be pruned on write.
2. **Icon URL shape.** `icon` uses the `bb.branding.icon` grammar (a named host
   glyph, or a `./`-prefixed plugin-relative SVG). A path is snapshotted at
   registration and served from `/api/v1/system/providers/<id>/logo`; a glyph
   name yields a null `logoUrl` and no server-side resolution at all. Decide
   whether the host should resolve declared glyph names for providers the way
   it does for plugin branding, and decide the logo route's cache policy,
   before either freezes into clients.
3. **Collision semantics.** Ids are first-come collision-rejected: a staged
   collision fails the whole plugin load; a post-activation registration
   throws to the plugin. With reservation gone, a disabled first-party plugin
   leaves its id claimable by anyone until it is re-enabled (which then fails
   to load). Confirm first-wins is right across plugin load order, and decide
   whether a namespace rule (plugin-scoped id prefixes) is wanted before
   third-party ids proliferate.
4. **Bridge delivery.** A provider bridge is a second consumer of the
   plugin's `bb.host` artifact: it is exported by name
   (`experimental_providerBridge`), built into `dist/host.js`, recorded in the
   one live-host-artifact registry, served by the one host artifact route, and
   cached once per plugin on the daemon. Thread commands carry `bridgeLaunch
{pluginId, source: {kind: "artifact", digest, byteLength}, envPassthrough}`.
   Pi is the one provider whose bridge stays daemon-bundled
   (`DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS`); every other provider, first-party or
   not, arrives as an artifact. Before stabilizing: confirm one artifact per
   plugin survives (a plugin declaring several providers today ships one bridge
   for all of them, and there is no way to name a second), confirm the
   single-bundle shape survives per-platform needs, and decide whether a
   router-kind declaration — a picker entry resolving to another provider at
   submit time, removed from the contract because nothing ever resolved one —
   returns as its own surface.
5. **What a capability may be.** `supportsHostAiServices` was removed after
   shipping: it declared that bb's voice-transcription and structured-inference
   features could route through the provider, which is a fact about the daemon
   bundle rather than about the provider. `supportsWorkflows` went the same
   way in WS2a: whether a session may use the Workflow tool is the Claude
   plugin's own knob (its `workflowsDisabled` setting, derived into
   `providerOptions`), not a fact core needs. Apply the same test to every
   remaining capability before stabilizing: a declaration may assert what the
   provider itself implements and an external consumer needs pre-session,
   never what bb or its daemon can do with it.
6. **Static bridge options and visibility.** Confirm 64 KiB remains a suitable
   declaration-time limit, that opaque options should continue to be shared by
   every host rather than resolved per host, and whether deep-frozen plain JSON
   is the right stable value contract. Confirm `"always" | "installed"` is
   enough listing policy, that health failure should continue to hide an
   installed-only provider, and that targeted requests may continue resolving
   a registered provider even while discovery says it is absent.

## Provider declaration target-state fields (`PluginProviderDeclaration.experimental_strings`, `experimental_serviceTiers`, `experimental_reasoningLevels`, `experimental_extensionKinds`, `experimental_family`, `experimental_models`, `experimental_env`, `experimental_deriveProviderOptions`; `ProviderInfo.strings`/`serviceTiers`/`reasoningLevels`/`extensionKinds`/`family`)

**What it does.** The target-state declaration fields from
[docs/provider-plugin-api.md](provider-plugin-api.md) §1 beside the existing
`capabilities`: provider copy (`strings`: sign-in and expiry hints, install
URL, brand prefix, plan-mode copy, icon tint), service tiers and reasoning
levels as `{ id, label, description? }` picker options, the extension kinds
the provider's bridge may emit (`{ item?, state? }` Standard Schema validators
keyed by local name), an optional `family` grouping key, a cold-cache
`models.fallback` list, the daemon `env.passthrough` variable names the
bridge may read, and the per-command `deriveProviderOptions(ctx)` hook.
`validatePluginProviderDeclaration` checks and deep-freezes them.

WS2a projects them: `ProviderInfo` carries `strings`, `serviceTiers` (the
declared list, or `default`/`fast` when only `supportsServiceTier` is set),
`reasoningLevels` (the declared options, or the coarse ladder labelled),
`extensionKinds` namespaced by the OWNING PLUGIN id, and `family`; the usage
banners (web + mobile), the model picker's brand strip and install link, and
the plan-mode permission display read `strings` instead of per-provider
tables. The fallback list is served by the model-list route when a probe fails
transiently (the app vendors no catalog). `env.passthrough` rides
`bridgeLaunch.envPassthrough` and the daemon forwards exactly those variables
past its `BB_*` spawn sanitization. The hook runs on every session and turn
command with `{ threadId, projectId, model, permissionMode, promptMode?,
settings }` — `settings` being the plugin's own non-secret `bb.settings`
values — and its bounded-JSON result rides the command as
`options.providerOptions`, merged over the static bridge options. The shared
execution contract carries no provider-named field: `claudeCodePermissionMode`,
`workflowsEnabled`, `memoryEnabled` and `providerSubagentsEnabled` are gone,
replaced by `promptMode: "plan"` (set only when the prompt entered plan mode
through the provider's declared `plan` composer action) and the bag. The
server validates extension payloads against the declared schemas at ingest
(`apps/server/src/internal/extension-payloads.ts`): the registry carries the
validators on each registration and resolves a namespaced kind through its
plugin-id prefix.

**Audit before stabilizing.**

1. **One reasoning-level source.** `capabilities.reasoningLevels` (an id
   ladder) and `experimental_reasoningLevels` (labelled options) say the same
   thing twice during the transition; the projection prefers the options and
   labels the ladder from a fixed table otherwise. Delete the ladder once every
   first-party plugin declares the option form, and decide whether the coarse
   `capabilities.supportsServiceTier` boolean survives beside
   `experimental_serviceTiers` or is implied by it. Likewise fold the three
   `experimental_provider{Health,Usage,Installation}` booleans into the doc's
   `maintenance` object when the prefixes drop (declaring both now would say
   one fact twice).
2. **Copy limits and markup.** `strings` values are capped at 512 characters
   and rendered as plain text. Confirm that is enough for every surface that
   reads them today (usage banners, the mobile picker, the guide) and that
   none of them needs inline Markdown or links. The plan-mode permission
   display keys on the PRESENCE of `planModeCopy`: a provider with a `plan`
   action but no copy (Codex) keeps its ordinary permission display. Confirm
   presence is the right switch rather than a separate boolean.
3. **Extension-kind ceiling and schema cost.** 32 kinds per provider and
   Standard Schema validators executed at server ingest are guesses. Confirm
   the ceiling against real plugins and set the payload size limit the server
   enforces before validating.
4. **Hook contract.** The hook is synchronous and runs on the turn-submit
   path; a throw fails the command with the plugin named. Confirm sync is
   enough (no plugin has asked for I/O), that omitting secrets from
   `ctx.settings` is the right rule, that the 64 KiB bound shared with bridge
   options fits, and whether `ctx` should carry the reasoning level and
   service tier too. The bag is persisted with the session and diffed
   structurally by the runtime to decide session vs. live changes; confirm
   that is the right granularity once bridges reconcile everything themselves.
5. **Fallback models and env passthrough.** The fallback list (64 max, exactly
   one default) is offered only on a transient probe failure; confirm the
   cold-cache composer (which now waits for the first probe) does not want it
   too, and that name-only env passthrough (no value validation, `BB_*` or
   otherwise) is the right scope.
6. **Provider settings migration.** Migration 0105 copies the five retired
   `codex*`/`claudeCode*` app-settings rows into `plugin_settings` for
   `provider-codex` / `provider-claude-code`. Confirm the plugin setting keys
   (`memoryEnabled`, `subagentsDisabled`, `workflowsDisabled`) before plugins
   outside this repo start reading them.

## `@get-bb/plugin-sdk/provider-bridge` (the provider-bridge authoring surface)

**What it does.** The published module a provider bridge compiles against. A
bridge ships inside its plugin's `bb.host` artifact, and a host artifact may
not import private `@bb/*` workspace packages, so everything a bridge needs is
named here: `experimental_defineProviderBridge` (the export shape the
daemon-side bootstrap looks for), the Provider Bridge Protocol's method
vocabulary, the `thread/delta` grammar, and param schemas, the bridge kit's
authoring helpers (JSON-RPC framing, tool-call and interaction codecs,
visibility, dialect-parsing helpers), and the `@bb/domain` command-plane
vocabulary those params reference.
Curated by hand — named exports only, never `export *`. Unlike
`@get-bb/plugin-sdk` and `@get-bb/plugin-sdk/host`, it is NOT a build-time
runtime stub: it is pure schema and helper code with no daemon-pinned
behavior, so a provider plugin depends on the SDK for real and the artifact
build inlines the SDK's published, self-contained bundle.

**Audit before stabilizing.**

1. **Resolved (Aug 2026, the narrow-grammar cutover): the protocol owns its
   own timeline vocabulary.** Bridges no longer construct `ThreadEvent`s —
   they emit the protocol's own `thread/delta` grammar and the runtime's
   assembler constructs every canonical event — so the `@bb/domain` event
   vocabulary (`ThreadEvent`, the item types, `threadScope`/`turnScope` and
   the scope helpers) left the surface with the kit's assembly machinery
   (turn-state registry, scoped-item-ids, accepted-user-messages, item
   constructors, unhandled-event builders). What still comes from
   `@bb/domain` is deliberate and consumed by bridges today: the
   command-plane and interaction surface the protocol's params are made of
   (`PromptInput`, `PendingInteraction*`, `DynamicTool`,
   `RuntimePermissionPolicy`, permission/reasoning/service-tier values,
   rate-limit state, workflow snapshots) plus the enum/status types the
   delta shapes reference (`ThreadEventItemStatus`, `ThreadEventTurnStatus`,
   `ThreadEventPlanStep`, `ThreadEventTokenUsageBreakdown`,
   `ThreadEventContextWindowUsage`, `ThreadEventUserContent`). Those are
   shared server/app/runtime contracts, so the facade re-export (bundle
   inlining, `@bb/domain` staying private) is the permanent answer for
   them.
2. **Surface size.** 184 names after the cutover (was ~190, then ~216 with
   the delta grammar added, then the assembly surface deleted: the
   turn-state/scoped-id/accepted-message/constructor helpers, the orphaned
   `buildEditDiff`/`withParentToolCallId`, and the unconsumed domain
   re-exports came off). Single-consumer
   repatriation done (Aug 2026): `extractEnvOverrides` and
   `getMessageContentTypes` moved into the claude-code plugin,
   `normalizePendingInteractionRequestedPermissionProfile` (whole
   `pending-interaction-normalization` module plus test) into the codex
   plugin, and the `cloneReasoningEfforts` helper out of `@bb/domain` into
   claude-code's model catalog. The other named candidates turned out not to
   be movable: they are `@bb/domain`/protocol definitions with core consumers
   — the `claudeTaskTool*` schemas share their contract file with
   thread-view, the `acp*Cli`/`acpNativeReasoning` schemas are parsed by
   host-daemon-contract and config, and the workflow snapshot types are
   rendered by the app. The surface is still large; any further shrink is a
   per-name product decision, not a mechanical move.
   A follow-up de-overfitting pass (Aug 2026) then unwound the kit's
   over-general helpers: `buildToolUseItem`'s parser-callback router became
   per-provider switches over plain constructors (`buildFileChangeItem`,
   `buildGenericToolCallItem`); the generic session registry was split into
   `createPendingToolCallTracker` plus consumer-owned session maps;
   claude-code stopped borrowing codex's `shell_environment_policy` namespace
   (`buildShellEnvironmentPolicyConfig` now lives in provider-codex,
   `diffCumulativeText` in pi); the zero-consumer native tool-call decoder,
   the `finishOpenProviderTurn` wrapper, and the per-consumer flags
   (`completeWebItems`, `preserveUndefinedToolCallFields`) came off the
   surface; and the shared accepted-user-message drain folded into the
   turn-state registry core.
3. **The ACP launch spec.** `hostDaemonAcpLaunchSpecSchema` is a
   server↔daemon wire shape a bridge parses out of its provider-scoped static
   options. It is the one core contract leaking into the published surface;
   decide whether provider-scoped static options should be opaque to bb with
   the schema owned by the ACP plugin, before the shape is a public promise.
4. **`experimental_apiVersion` 1.** The bootstrap accepts version 1 only and
   refuses anything else by name. Decide the deprecation window for a version
   bump (a plugin's artifact and the daemon update independently) before the
   first third-party bridge ships.

## `@get-bb/plugin-sdk/provider-bridge/testing` (the provider-bridge testing kit)

**What it does.** The published kit a bridge author proves a bridge with
before shipping it, with no private `@bb/*` package in reach: the
conformance kit (`experimental_runBridgeConformance`,
`experimental_formatConformanceReport`, `experimental_ConformanceClient`,
`experimental_checkItemOpensBeforeDelta`) that drives a bridge through the
canonical protocol scenarios; the real delta assembler
(`experimental_createDeltaAssembler`, `ASSEMBLER_GRAMMAR_VERSIONS`) — the
exact code the daemon runs, so a test sees the canonical `ThreadEvent`s the
runtime would build from the bridge's `thread/delta` stream; the delta→event
collector that feeds captured notifications through it
(`experimental_createBridgeDeltaEventCollector`,
`experimental_assembleCapturedThreadEvents`,
`experimental_toConformanceMessages`); the in-process JSON-RPC harness
(`experimental_captureBridgeJsonRpcOutput`,
`experimental_createBridgeJsonRpcTestHarness`); and the calibration
normalizer (`experimental_normalizeCalibrationEvents`,
`experimental_describeCalibrationEvents`).
Framework-agnostic (the stdout capture patches `process.stdout.write`
itself; nothing imports a test runner). Curated by hand, named exports only.
The echo example and every first-party bridge suite import only this entry
and `@get-bb/plugin-sdk/provider-bridge` — the "zero first-party privilege"
proof for the testing surface. In-repo the kit is `@bb/provider-bridge-
protocol`'s `assembler`, `conformance`, and `testing` subpaths.

**Audit before stabilizing.**

1. **The assembled-event lane.** The conformance kit's grammar checks run
   over canonical `ThreadEvent`s, so a transport assembles the bridge's
   deltas and re-emits them on the kit-internal
   `CONFORMANCE_ASSEMBLED_EVENT_METHOD` notification
   (`experimental_toConformanceMessages`). Now that the assembler lives
   beside the kit, the kit could assemble itself and the lane could go;
   decide before the transport shape is a public promise.
2. **Calibration normalizer scope.** `experimental_normalizeCalibrationEvents`
   interns the id fields the first-party goldens needed
   (`turnId`, `itemId`, `id`, `parentToolCallId`) and drops
   `providerCheckpointId`. Confirm the defaults against a third-party
   bridge's goldens before fixing them.
3. **Surface size.** 14 value exports plus 20 types. The JSON-RPC harness
   duplicates a little of the bridge kit's envelope parsing; fold or keep
   deliberately.

## `app.experimental_useProviders` (`@get-bb/plugin-sdk/app`)

**What it does.** The provider directory for plugin frontends: `{ status,
providers }` where `providers` is the host's own `ProviderInfo[]` roster in
picker order (the same query the composer's provider tabs read, shared cache,
realtime invalidation). Pairs with the backend `bb.sdk.providers.list()`. It
exists so that a plugin showing a thread's provider (tasks, automations,
provider-retry) stops vendoring provider names, icons, and copy.

**Audit before stabilizing.**

1. **Routing.** The hook reads the primary-host roster (no `environmentId` /
   `hostId` argument), so installed-only providers of another machine are not
   listed. Decide whether plugins need host-scoped listing before freezing the
   signature.
2. **Icons.** `logoUrl` is null for the bundled first-party providers (their
   marks are vendored in the app), so a plugin still cannot draw every
   provider's icon from this hook alone. Decide whether the host serves its
   vendored marks through the logo route, or exposes an icon component, before
   telling plugins to delete their copies.

## `app.slots.experimental_providerIcon` (`@get-bb/plugin-sdk/app`)

**What it does.** Lets a plugin frontend supply the React component bb draws
as one agent provider's icon: `{ providerId, icon }`, where `icon` receives
only the host's `className` (sizing plus the provider color class). The
component wins over the app's vendored brand map and over the provider's
`logoUrl`; a file logo (manifest `branding.icon`, a path-shaped provider
`icon`) stays
the right home for static color logos, because it is fetched through `<img>`,
a separate document where `currentColor` resolves to black — invisible on dark
themes. Registrations are replaced wholesale with the rest of the plugin's
slot set, so disable/uninstall/failed reload falls back to the vendored map,
then `logoUrl`, then the generic glyph. The four first-party provider plugins
do not use it: their marks are vendored in the host (`BUILT_IN_BRAND_ICONS`),
and shipping an app bundle only to register the same SVGs cost four JS+CSS
fetches and four icon remounts at every boot.

**Audit before stabilizing.**

1. **Id squatting and scoping.** `providerId` names a provider in a shared
   namespace, not a per-plugin slot id, and nothing checks that the plugin
   registering it also declared that provider. Today the host keeps the first
   claim by sorted plugin id and warns. Before stabilizing, decide whether the
   host should reject an icon for a provider the plugin does not own (the
   frontend does not currently know the registry's provider→plugin mapping),
   and whether the picker should surface a rejected claim to the user.
2. **Bundle size and boot ordering.** An icon now costs a frontend bundle: a
   provider plugin that previously shipped only a server entry pays esbuild +
   Tailwind on install and an extra module fetch at boot, and the vendored map
   covers the window before the bundle loads. The first-party provider plugins
   dropped their icon-only bundles for exactly this reason. Confirm the cost is
   acceptable for third-party icon-only plugins, or add a lighter delivery
   path (e.g. a declared inline SVG string sanitized by the host) before
   freezing the shape.
3. **Disposal and identity.** The icon component is resolved through a cached
   host wrapper keyed by provider id and `logoUrl`; the wrapper subscribes to
   the slot store so a disposed registration falls back mid-render. Audit that
   a crashing plugin icon is contained the way other slot components are (it
   renders inside host chrome, sometimes outside a slot error boundary), and
   that no host surface caches the resolved component across a reload.
4. **Rendering contract.** The host promises only `className` and expects
   inline markup. Decide whether to enforce that (no fetches, no portals, no
   interactive content) before plugins rely on richer components, and confirm
   the accessible label story: the host derives `ariaLabel` from its own
   provider data, falling back to the provider id, and the slot supplies none.

## `experimental_ProviderModelPicker` (`@get-bb/plugin-sdk/app`)

**What it does.** Exposes bb's execution picker as a controlled
`{ providerId, model, reasoningLevel, serviceTier? }` component for plugin
frontends. The host adapter reuses `useThreadCreationOptions` for catalog,
fallback, reasoning reconciliation, service-tier capability, retired-model,
branding, and model-projection policy, and renders the same
`ModelReasoningPicker` used by first-party composers. A provider tab is a
preview until its authoritative catalog resolves; the component then emits the
provider, default model, reconciled reasoning, and supported service tier as
one value without closing the picker, matching the composer. `routing` can
target one enrolled host or an existing environment;
omitting it uses primary-machine routing. `disabled` renders the same summary
without opening the picker. Verified catalogs also normalize an empty or stale
controlled selection; placeholder, failed, and empty catalogs do not.
`allowProviderChange={false}` hides provider tabs while retaining model,
reasoning, and service-tier selection for the controlled provider. Routing
never implies provider locking: an environment supplies host/workspace context
and can run more than one provider. `align` optionally places the popover at
the trigger's `"start"`, `"center"`, or `"end"` edge and defaults to
`"start"`.

Tasks delegation presets and Automations agent execution both use this
component end to end. They persist the same tuple and pass it to
`bb.sdk.threads.spawn`; neither plugin exposes a parallel catalog RPC.

Implementation: `apps/app/src/components/plugin/PluginProviderModelPicker.tsx`,
bound in `apps/app/src/lib/plugin-sdk-app-impl.tsx`.

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
   catalogs never change the controlled value. A verified catalog normalizes
   stale values while selected-only retired models survive. Confirm silent
   retention on failure and automatic correction on success are preferable to
   explicit callbacks.
5. **Scope.** Validate settings and compact-form usage in external plugins,
   especially whether they need an explicit loading/error callback. Tasks and
   Automations currently rely on the picker-owned loading/error UI. Environment,
   permission, and prompt submission stay separate controls.

## `experimental_PermissionModePicker` (`@get-bb/plugin-sdk/app`)

**What it does.** Exposes BB's permission picker as a controlled
`{ providerId, value, onChange, routing?, align?, disabled?, className? }`
component. `align` accepts `"start"`, `"center"`, or `"end"` and defaults to
`"end"` for compatibility with the prompt-row placement.
The host adapter reuses `useThreadCreationOptions` and `PermissionModePicker`,
so supported modes, fallback order, compact labels, and the routed machine's
permission ceiling are identical to the composer. It displays modes above the
ceiling as disabled with the host explanation, renders a locked summary for a
provider with one mode, and emits a corrected mode when an authoritative
provider/routing change invalidates `value`. Placeholder, loading, and failed
lookups never mutate the controlled value.

Tasks delegation presets and Automations use this component beside
`experimental_ProviderModelPicker`; their frontend bundles no longer read the
provider directory or implement permission reconciliation. Server-side spawn
and update validation remains authoritative.

Implementation: `apps/app/src/components/plugin/PluginPermissionModePicker.tsx`,
bound in `apps/app/src/lib/plugin-sdk-app-impl.tsx`.

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

## `experimental_NewThreadComposer` (`@get-bb/plugin-sdk/app`)

**What it does.** The host-owned new-thread compose surface, the create-side
counterpart to `ThreadChat`. It renders bb's full control set — prompt editor
with @-mentions and expand, `+` attachments, provider/model/reasoning picker,
voice, submit, and the row beneath with project, environment, "Branch from:",
and permission mode — and calls `onSubmit` with a `NewThreadRequest`
carrying every resolved selection.

The composer deliberately does **not** create the thread. The plugin does,
through `bb.sdk.threads.spawn`, which auto-fills `origin: "plugin"` and
`originPluginId`. If the component created the thread it would go through the
host's `useCreateThread` and the thread would look host-originated. So the
rule is: the composer owns user selections; the plugin owns filing
(`sectionId`, `parentThreadId`, `title`, `visibility`) and attribution.

Implementation: the shared workflow is
`apps/app/src/components/promptbox/NewThreadComposer.tsx`; the SDK adapter is
`apps/app/src/components/plugin/PluginNewThreadComposer.tsx`, bound in
`apps/app/src/lib/plugin-sdk-app-impl.tsx`.

**Audit before stabilizing.**

1. **`NewThreadRequest` vs. what `threads.spawn` accepts.** The type mirrors
   the subset of `CreateThreadRequest` a composer can resolve. Confirm every
   field still round-trips through `bb.sdk.threads.spawn` unchanged, that
   `executionInputSources` still means the same thing to the server, and that
   no newly required create-thread field is silently missing. Note the
   composer runs `useThreadCreationOptions` with `scope: "component-local"`,
   which never reports a `providerId` provenance source even though the
   composer always sends an explicit `providerId`; decide whether that is
   correct before freezing the shape.

2. **Page-level behavior the adapter skips.** Fork seeds,
   quick-create-project, the guided machine-setup dialog, welcome/empty
   states, and codex-version submit blocking are all deliberately absent.
   Confirm none of them has become load-bearing for correctness (rather than
   convenience) on a plugin surface — codex-version blocking in particular
   means a plugin can submit to a machine whose CLI the primary surface would
   have refused.

3. **Draft and selection scoping.** Drafts persist under a
   `plugin-new-thread` scope keyed by `draftKey ?? pluginId`, and execution
   selections are component-local so a plugin panel never rewrites the user's
   persisted root-composer defaults. Confirm that is still the behavior
   plugin authors expect, and that `draftKey` is the right knob (versus, say,
   a per-instance ephemeral draft).

4. **No plugin composer host binding.** The instance passes no
   `pluginComposerHost`, so plugin composer customizations, banners, and
   `useComposer()` writes do not reach it. Decide whether composers rendered
   by a plugin should participate in that surface before stabilizing.

5. **Seeding props and the round-trip guarantee.** The `default*` props
   (`defaultProviderId`, `defaultModel`, `defaultReasoningLevel`,
   `defaultServiceTier`, `defaultPermissionMode`, `defaultEnvironment`) seed
   the composer from a stored `NewThreadRequest` so a plugin can re-open a
   saved configuration without silently resetting it to project defaults.
   They are seeds (uncontrolled), take precedence over project defaults, and
   re-seed on any value change — including user-touched selections — via the
   creation-options resetKey. `defaultEnvironment` maps args back to picker
   selections in
   `apps/app/src/components/plugin/new-thread-environment-seed.ts`; its
   unrepresentable variants (`project-default`, `personal` without a
   `hostId`, an `unmanaged` `path`) are documented on the prop. Before
   stabilizing, confirm the mapping still inverts
   `resolveRootComposeThreadEnvironment` (the round-trip tests in
   `new-thread-environment-seed.test.ts` and
   `PluginNewThreadComposer.test.tsx` guard this) and re-decide whether the
   re-seed-on-change rule should instead be an explicit reset nonce.

6. **Projectless contract.** The picker always offers "Don't work in a
   project", including when a plugin seeds a specific project. That choice
   submits the personal-project id (not `null`) with a `personal` workspace;
   plugin authors forward both fields unchanged and must opt into personal
   project metadata with `projects.list({ includePersonal: true })`. Before
   stabilizing, confirm unconditional project switching is right for embedded
   plugin workflows, rather than adding an explicit project-locking policy.

## `app.slots.experimental_newThreadPanelAction` (`@get-bb/plugin-sdk/app`)

**What it does.** Adds a plugin row to the root New thread screen's
right-panel Actions list. Activating it can open a closable panel tab whose
component receives `{ projectId: string | null, params: JsonValue | null }`.
It deliberately does not reuse `threadPanelAction`: that existing contract
requires `threadId: string`, and the in-repo and external consumers built
against it may assume a thread exists. The two slots are surface-specific and
never cross-render.

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
   had time to adopt the root surface deliberately. The two contexts' `openPanel`
   signatures were already unified: both take `PluginPanelActionOpenOptions` and
   return `boolean` (true = accepted, false = declined), matching
   `messageAction`'s `openPanel` and `useBbNavigate().openThreadPanel`. Do not
   re-litigate that in the stabilization audit; audit only whether the two
   _contexts_ should merge.

## `app.slots.experimental_threadList` (`@get-bb/plugin-sdk/app`)

**What it does.** Replaces the sidebar's scrolling thread list with a plugin
component. Unlike every other `app.slots.*` member this slot is **exclusive**:
one list at a time fills the scroll area. Automatic activation is the default.
If several are registered, the first in the slot snapshot wins (plugin ids are
sorted, then each plugin's registration order is preserved); removing the
automatic winner reveals the next. The user can override that behavior under
Settings → Appearance by pinning BB's list or a specific provider; the choice
is stored per client. A plugin-owned enable/disable setting can also live in
the component, which renders `experimental_Original` when disabled.

Fallbacks keep the sidebar usable: no automatic provider renders BB's list; an
unavailable pinned provider temporarily renders BB's list without erasing the
choice; and a crashing component renders BB's list (not the usual "plugin
crashed" chip, which in place of a whole sidebar would strand the user) plus
one toast.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned/built-in is the right long-term
   selection model and alphabetical plugin-id order is an acceptable default
   tie-breaker when multiple replacements are enabled.
2. **Fallback discoverability.** Confirm one toast is the right signal when a
   crash silently swaps the user's sidebar back.
3. **Region boundary.** The plugin gets the scrolling list and nothing else:
   the New-thread button, search field, plugin nav rows, and footer stay
   host-rendered, because they are shared surfaces (other plugins live in two
   of them) and a replaced list must not remove them. Confirm no real sidebar
   needs to claim more, and that passing those regions down as props — letting
   a plugin place them, at the risk of dropping them — stays the wrong trade.
4. **Search ownership.** The host owns the search field and passes
   `searchQuery` down. Confirm a plugin list never needs its own field.
5. **Accessibility.** Confirm the host can still guarantee list semantics,
   focus order, and the mobile close behavior when a plugin owns the markup —
   `onNavigate` is currently the plugin's responsibility to call.

## `PluginThreadListProps.experimental_Original` (`@get-bb/plugin-sdk/app`)

**What it does.** Supplies the thread-list replacement with BB's list already
bound to the current sidebar instance. Rendering it explicitly delegates to
the owner without re-entering replacement resolution; the host also renders it
when the plugin component crashes.

**Audit before stabilizing.**

1. Confirm a no-props, instance-bound component remains the smallest useful
   delegation contract as thread-list context grows.
2. Verify owner delegation preserves search state, mobile navigation, keyboard
   shortcuts, split behavior, and all BB-owned row affordances.
3. Confirm the owner renderer stays lazy enough that a plugin replacement
   which never delegates does not eagerly load a second list implementation.
4. Revisit whether the field should remain tied to the experimental thread-list
   registration or stabilize together with the replacement primitive shared by
   other surfaces.

## `PluginFileOpenerProps.experimental_Original` (`@get-bb/plugin-sdk/app`)

**What it does.** Supplies a file-opener replacement with BB's preview bound to
the file named by `path` and `source`. A plugin can render it conditionally, and
the host uses it as the crash and missing-provider fallback without resolving
the same plugin again.

**Audit before stabilizing.**

1. Verify the bound preview preserves source-specific behavior for workspace,
   host, project, and thread-storage files, including relative links, line
   ranges, open-in-editor actions, and selection-to-composer actions.
2. Confirm the no-props bound component is preferable to an owner component
   which receives the existing `{ path, source }` props again.
3. Confirm delegation and crash fallback retain the current file tab identity
   and do not remount unrelated panel state.
4. Verify the owner renderer remains independent of provider precedence and
   cannot recurse through file-opener resolution.

## `PluginFileOpenerSource.experimental_hostId` (`@get-bb/plugin-sdk/app`)

**What it does.** Identifies the explicit host selected for a project-backed
workspace file when a file opener cannot resolve that source through a thread
or environment. It is omitted for environment-backed workspace files, host
files, thread-storage files, and project files that use the primary host.

**Audit before stabilizing.**

1. Confirm an explicit host id is the minimum missing project-routing context,
   rather than exposing the whole project workspace routing union.
2. Verify project-compose file tabs retain the selected host across reloads,
   host changes, plugin fallback, and per-open viewer overrides.
3. Decide whether host identity should be present for every source kind or
   remain project-specific once more file opener plugins exercise the API.
4. Confirm omission should continue to mean primary-host resolution and that
   this remains compatible with persisted opener tabs created before the field
   existed.

## `experimental_SourceCode` / `experimental_Diff` (`@get-bb/plugin-sdk/app`)

**What it does.** Two host-owned renderers for supplied code content.
`experimental_SourceCode` takes source text plus a path and owns syntax
highlighting, gutters, wrapping, highlighted-line presentation, and the live BB
code theme. `experimental_Diff` takes a single-file patch plus a path and
optional `experimental_fullFileContents` for both text sides, and owns patch normalization
(a patch without a `diff --git` header is completed from `path`, which is what
makes GitHub's REST patches and bare `@@` hunks render), context enrichment,
syntax highlighting, unified/split presentation, gutters, and the same live
theme. Patch content that will not parse degrades to plain monospace text. The
caller still owns loading file contents; omission means a patch-only render
without context expansion.

These are the same components BB's own file preview, timeline file diffs, and
environment diff panel render through, so an active
`experimental_sourceCodeRenderer` / `experimental_diffRenderer` replacement
covers first-party surfaces and plugin surfaces at once. Fetching files or git
data, multi-file lists, tabs, card headers, git actions, and add-to-prompt
behavior deliberately stay with the caller.

**Audit before stabilizing.**

1. **Prop surface.** Confirm content + path + presentation plus optional full
   diff sides is the right minimal contract, and decide whether `className`
   belongs in it at all — a
   replacement never receives it today, so a `className` that only styles BB's
   renderer is a quiet inconsistency.
2. **Diff input shape.** Confirm single-file patch text is the right currency.
   Multi-file patches, `processFile`-style pre-parsed input, and per-hunk
   rendering are all things callers have wanted; none are expressible now.
3. **Language selection.** Highlighting is inferred from `path` only. Confirm
   an explicit language override is not needed before the names freeze, and
   that no implementation-library language union leaks in when it is added.
4. **Worker pool.** Highlighting needs BB's Pierre worker pool from React
   context. Thread panes and plugin nav panels provide one; homepage and
   settings sections do not, so a diff rendered there is unhighlighted rather
   than broken. Decide whether the host should provide the pool at the
   component instead of the surface.
5. **Selection to chat.** BB's own surfaces pass a selection-to-composer
   handler that the public component withholds. Confirm plugins should reach
   that through `useComposer()` rather than a renderer prop.
6. **Size and virtualization.** Neither component caps input size or
   virtualizes. Audit against a plugin that renders a very large file or patch.
7. **Resolved (Aug 2026): context expansion takes resolved semantic data, not
   a loader callback.** `experimental_fullFileContents` carries required `old` and `new`
   `{ path, content }` objects. This keeps lazy loading, retries, and viewport
   policy with the caller while letting BB's renderer and a replacement consume
   complete UTF-8 sides without exposing Pierre's `FileContents` type. A
   replacement always receives the caller-resolved field as an object or
   `null`, and owns patch-consistency validation if it uses those contents for
   expansion. BB's original validates only when its lazy renderer mounts.

## `app.slots.experimental_sourceCodeRenderer` / `app.slots.experimental_diffRenderer` (`@get-bb/plugin-sdk/app`)

**What it does.** Replaces BB's source or diff renderer everywhere it draws
supplied content — the native file preview, timeline file diffs, the
environment diff panel's file bodies, and every plugin calling the public
components. Like `experimental_threadList` these slots are **exclusive**: one
renderer each. Registering activates it while the plugin is enabled; if several
are registered the first in slot snapshot order wins (plugin ids sorted, then
each plugin's registration order). The user can override that under
Settings → Appearance ("Source code" and "Diffs") by pinning BB's renderer or
a specific provider; the choice is per client, and it is the same
automatic/built-in/named-provider model the sidebar thread list uses. There are
deliberately no scope, extension, or enabled-by-setting filters on the
registration — conditional behavior belongs in the component, which decides per
call from its semantic props and renders `experimental_Original` when it does
not want the render.

Fallbacks: no registration renders BB's renderer; a disabled or uninstalled
plugin reveals the next registration or BB's renderer; a component that throws
renders BB's renderer through the slot's crash fallback. A pinned provider that
is temporarily unavailable renders BB's renderer without erasing the pin.

**Audit before stabilizing.**

1. **Arbitration.** Confirm automatic/pinned/built-in is the right long-term
   selection model here as it is for the thread list. **Resolved (Aug 2026):
   the pin stays per client.** A device-local override matches the sidebar
   thread list, even though the key/value app settings added in #1875 would
   now make an account-level pin cheap to add. Still open: the two renderers
   pin independently; confirm users do not instead expect one "code rendering"
   choice.
2. **Resolved (Aug 2026): a crash swaps back to BB's renderer silently.**
   A diff card is not a whole sidebar — the reader still sees a correct diff,
   where a blank thread list strands them — so neither host passes `onCrash`.
   Authors are not left without a signal: `PluginSlotBoundary` still
   `console.warn`s the plugin id, slot key, and component stack. The hosts pass
   no `instanceId`, so the first crash disables the slot for the session rather
   than letting cards crash one at a time.
3. **Resolved (Aug 2026): the replacement is global, other plugins'
   surfaces included.** "Install this and every diff looks like X" is the
   point; covering BB's surfaces but not the GitHub plugin's would be a
   half-measure, and a plugin calling `experimental_Diff` would silently opt
   its users out. No first-party-only or own-surfaces-only scope. Audit this as
   precedent rather than as a fact about these two slots: no other slot lets a
   plugin reach into another plugin's rendered output.
4. **Capability parity. Resolved for context expansion (Aug 2026):** a
   replacement receives `experimental_fullFileContents` as an object or `null`,
   matching the public host component and first-party diff cards. These are
   caller-resolved contents; a replacement that implements expansion also owns
   consistency validation against `patch`. Selection-to-chat and the
   deleted-file gate remain host-only; confirm that remaining asymmetry is
   acceptable, or promote either capability before stabilization.
5. **Two slots or one.** Confirm source and diff should stay separately
   replaceable rather than one "code renderer" registration.

## `PluginSourceCodeRendererProps.experimental_Original` / `PluginDiffRendererProps.experimental_Original` (`@get-bb/plugin-sdk/app`)

**What it does.** Supplies a renderer replacement with BB's renderer bound to
the current render. Rendering it delegates without re-entering replacement
resolution; the host renders the same component as the crash fallback. BB's
renderers are behind `lazy()`, so a replacement that never delegates never
downloads them.

**Audit before stabilizing.**

1. Confirm a no-props bound component stays the right delegation contract as
   the host-only inputs (pre-parsed files, selection-to-chat) grow.
2. Verify delegation preserves everything the owner path does on BB's own
   surfaces — context expansion, line selection, highlighted-line scrolling —
   when the replacement delegates from inside a first-party card.
3. Confirm the lazy boundary stays lazy: a replacement that never delegates
   must not pull BB's renderer chunk, and the Suspense fallback must not
   flash on the owner path.
4. Decide whether this field should stabilize together with the shared
   replacement primitive that `PluginThreadListProps` and
   `PluginFileOpenerProps` also use, rather than per surface.

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

**What it does.** Gives a plugin component the sidebar's live thread view and
the actions that mutate it. The read hook wraps the host's own
`useSidebarNavigation` query — the same cache and realtime subscriptions the
built-in sidebar uses — so a plugin list costs no extra request and updates on
exactly the same events. The action hook routes to the host's own mutations, so
optimistic updates, toasts, and cache invalidation are identical.

`PluginSidebarThread` is a deliberate copy of the fields a sidebar needs, not a
re-export of the internal `ThreadListEntry`. `indicator` is
`resolveThreadListIndicator` already run by the host, so plugins inherit bb's
precedence (attention before work; plan and goal before the spinner) instead of
reimplementing it, and `indicatorLabel` carries the matching accessible string.

**Audit before stabilizing.**

1. **DTO scope.** Confirm every field earns its place and that the copy stays
   worth its maintenance over `ThreadListEntry`. `hasUnsubmittedDraft` is
   deliberately absent (client-local composer state); confirm plugins do not
   need it. `host` is resolved host-side to `{ id, name }` because a plugin
   cannot turn a host id into a machine name — confirm resolution belongs here
   rather than in a separate hosts hook, and that falling back to the id for an
   unknown host is the right failure.
2. **Indicator coupling.** `indicator` freezes bb's precedence into the
   contract. Confirm new kinds can ship without breaking plugins, and that the
   documented "treat unknown as none" rule is enough.
3. **Unread semantics.** `isUnread` is plain read state, so it is true for
   child threads and running threads that `isUnreadDoneThread` excludes by
   design. Confirm that is the more useful primitive for a replaced list.
4. **Scale.** Confirm one array of every thread is right at ten thousand
   threads, versus a paged or windowed read. Today the host memoizes each
   thread DTO per unchanged `ThreadListEntry` (React Query structurally shares
   the payload), so a refetch that changes one thread hands plugins the same
   objects for every other thread and a `memo`/compiler-memoized row bails
   out; the array itself is new whenever the payload changes. Plugin lists
   are still expected to window their rows (the built-in sidebar does): the
   host does not cap the array, and mounting one row per thread on a phone is
   the plugin's cost. Decide whether that expectation should be enforced by
   the contract (paged/windowed read) before stabilizing.
5. **Draft indicators.** `indicator` never reports "draft" or "working-draft",
   because an unsubmitted draft is per-composer client state the host reads per
   row. An idle unread thread holding a draft therefore reads as
   "unread-success" where the built-in row paints "draft". Decide whether to
   close that gap (a per-thread draft hook) or keep it documented.
6. **Action surface.** Destructive and dialog-bearing actions route through
   `useThreadActions()`, so `archive` closes panes and repairs the route, and
   `requestDelete` opens bb's confirmation rather than deleting silently.
   Confirm that split (silent `rename`, host-confirmed delete) is the right
   line, and decide whether bulk actions and undo belong here.
7. **Permission.** Decide whether `archive` and `requestDelete` need any plugin
   permission gate beyond installation trust.
8. **`experimental_useSidebarThreadPullRequest`.** Per-row and opt-in, because
   a PR lookup hits the git host and therefore cannot sit on the payload every
   sidebar loads. It reuses the host's environment-keyed query, so threads
   sharing a worktree share one lookup and the host keeps its own staleness and
   refetch rules. Before stabilizing, confirm: the narrowed DTO (number, title,
   url, state, attention) is enough without leaking checks/review/mergeability;
   a sidebar of many distinct worktrees does not stampede the git host; and
   returning `null` for "lookup failed" (rather than an error) is the right
   failure for a row that should simply show nothing.
9. **`experimental_useSidebarThreadSplit`.** Gives a custom row the built-in
   drag-to-split gesture: spread `splitProps` onto the row, gate any affordance
   on `isAvailable`, and read `layout` to paint where the thread already sits.
   The host owns every rule — the drag engages only after the pointer leaves the
   sidebar, an edge drop splits, a center drop replaces, an open thread focuses
   its pane, and the pane cap turns a split into a replace — so a plugin cannot
   reach a layout the built-in sidebar cannot. Before stabilizing, confirm: a
   list with its own pointer-drag (reorder, swipe) still composes with the
   host's engage threshold; `splitProps` staying an open object is the right
   forward-compatible shape, or it should narrow to a named handler; and
   exposing the full `panes` array does not leak more layout state than a row
   needs.

## `app.slots.experimental_threadHeaderAction` (`@get-bb/plugin-sdk/app`)

**What it does.** Renders a plugin component in the thread header's action row.
The frontend sibling of the backend `bb.ui.registerThreadAction`, which renders
a host-owned button and runs server-side: use that one for "do a thing", and
this one when the control must draw live state (a count, a cluster, a status).

The host places it at the left end of the row, before the workspace button, git
actions, the panel toggle, maximize, and close — the same slot the backend
actions already use. It mounts once per pane, each with that pane's `threadId`.
A crash removes just that control and leaves the rest of the header working.

**Audit before stabilizing.**

1. **Two APIs, one region.** `bb.ui.registerThreadAction` and this slot now
   share a row. Confirm the ordering rule between them, and whether the two
   should merge behind one registration.
2. **Budget.** The row is short and already holds five host controls. Decide a
   cap, or an overflow behavior, before three plugins each add one.
3. **Compact viewport.** `isCompactViewport` asks every plugin to collapse
   itself. Confirm that beats a host-owned overflow menu.
4. **Per-pane mounting.** Confirm plugins handle mounting once per pane, and
   that a popover opened in one pane cannot leak into another.
5. **Height discipline.** The host clamps the control's layout box
   (`max-h-7 max-w-64`) so it cannot grow the chrome row, but deliberately does
   NOT clip overflow — clipping also hides a popover anchored to the control,
   which is the normal way to show anything taller. A plugin can therefore
   still paint outside the row. Decide whether that trade is right, or whether
   the host should require a portal.
6. **Other headers.** Decide whether the compose screen, plugin panels, and the
   workspace header need the same slot, or stay host-only.

### Note on `experimental_threadHeaderAction` crash isolation

`PluginSlotMount` takes an optional `instanceId` that participates in the
crashed-instance key, so one pane's crashed header control does not disable the
other pane's copy (or release its owned state). The thread-list slot omits it
deliberately: it mounts once, and a crash there should disable it everywhere.
Confirm that split before stabilizing, and decide whether other multi-mount
slots need the same treatment.
