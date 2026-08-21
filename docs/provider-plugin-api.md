# Provider plugin API (target state)

This document describes the **target** shape of BB's provider plugin surface —
what "a provider is a plugin" means once the surface is uniform. It is not a
status report and it has no phases. Each workstream that touches this surface
keeps this document true; a test compiles its code blocks against the real
types.

A "provider" is a coding agent BB can run a thread on (Claude Code, Codex, Pi,
ACP agents such as Cursor or Amp). The design goal is that **everything a
provider touches is owned by its plugin** — translating the agent's native
output into BB's data model, projecting that data onto the timeline, and how
its tools are represented — with the smallest possible provider-agnostic core.

## Principles

1. **Zero first-party privilege.** First-party providers use only the public
   API. Every special case is a public primitive or is deleted.
2. **Each fact lives in one place.** A capability is declared or reported,
   never both. Presentation comes from the bridge, never from core tables.
3. **Core understands a small semantic vocabulary.** Everything else is an
   extension kind with mandatory declarative presentation.
4. **Every client renders everything without plugin code.** Plugin renderers
   are a web upgrade; mobile renders the declarative base.

## Layers

A provider's output flows through these layers. The plugin owns the first two;
core owns the rest and never branches on a provider id.

```
host agent  ─►  bridge (plugin)  ─►  thread/delta (core vocabulary)  ─►
delta assembler (core)  ─►  ThreadEvent (core)  ─►  persistence (core)  ─►
timeline projection (core)  ─►  renderers (core + optional plugin web renderer)
```

## 1. Registration (plugin server code)

A plugin registers one or more providers through `bb.providers.register`. One
plugin may own several providers (the ACP plugin owns Cursor and the
user-configured agents); user-configured instances are rows in the plugin's
own settings that produce registrations at runtime.

```ts
bb.providers.register({
  id: "claude-code",             // flat; first registration wins; no reservation
  displayName: "Claude Code",
  family: undefined,             // optional grouping; replaces the acp- prefix
  icon: { asset: "./icons/claude.svg" }, // or { glyph: "Zap" }
  strings: {
    signInHint: "Run `claude` on the machine to sign in.",
    expiredHint: "Your Claude session expired. Run `claude`, then reload.",
    installUrl: "https://docs.anthropic.com/claude-code",
    brandPrefix: "Claude ",      // optional; stripped from model display names
    planModeCopy: undefined,     // optional; plan-mode banner copy
    iconTint: undefined,         // optional { light, dark }
  },
  permissionModes: ["accept-edits", "auto", "full"], // closed core enum
  reasoningLevels: [             // fallback ladder; model/list is precise
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
  serviceTiers: undefined,       // optional; open list, model/list is precise
  fork: "checkpoint",            // "none" | "tip" | "checkpoint"
  supportsNativeUserQuestion: true,
  supportsManualCompaction: true,
  maintenance: { health: true, usage: true, installation: true },
  composerActions: [{ kind: "plan" }], // or { name, trigger, description }
  extensionKinds: {},            // "<name>": { item?: Schema, state?: Schema }
  models: { fallback: [] },      // cold-cache placeholder only
  env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
  deriveProviderOptions(ctx) {   // called on every command
    // ctx: { threadId, projectId, model, permissionMode, promptMode?, settings }
    return {};                   // opaque JSON handed to this plugin's bridge
  },
})
// => { dispose(): void }
```

Rules:

- Capabilities project to exactly one client shape, `ProviderInfo`.
- The plugin learns per-instance truth itself (probe through its own host RPC,
  register conservatively while the host is offline, re-register on connect).
- Picker order and the default provider are user settings; the initial default
  is plugin install order. First-party plugins install first at bootstrap.
- Third-party ACP agents (for example Amp) register the same way, with a
  bridge built from the published ACP kit.

## 2. Bridge (plugin `bb.host` artifact, runs on the host)

```ts
export const providerBridge = defineProviderBridge({ handleLine, start, onClose })
```

One process per provider artifact; the bridge supervises any child processes.
The runtime never scopes processes per thread and never matches error text.

**Handshake** (reported per session at `initialize`, never declared):

```ts
{
  grammarVersions: [min, max],  // the delta-grammar range this bridge speaks
  sessionRestore: boolean,
  threadArchive: boolean,
  threadRename: boolean,
  approvalEnforcedBy: "runtime" | "provider",
  steerMode: "inject" | "queue",
}
```

**Runtime → bridge**: `model/list`,
`thread/{start,resume,fork,stop,discard,archive,unarchive,name/set}`,
`turn/{start,steer}`, `skills/configure {roots}`, `skills/scanRoots {cwd}`,
`provider/{health,usage,installation/status,installation/run}`.

Execution options ride every command and carry no provider-named field:

```ts
{ model, serviceTier?, reasoningLevel, promptMode?, instructions,
  providerOptions: JsonValue } & PermissionPolicy
```

**Bridge → runtime**: `thread/delta` (one streaming dialect, one usage
dialect), `provider/recovery`, `session/replaced`, plus the request channels
`item/tool/call` and `interaction/request`.

Recovery is typed, never text-matched:

```ts
// provider/recovery
{ kind: "sessionArchived" | "authRequired" | "restartRecommended"
       | "staleTurn" | "rateLimited",
  message: string, retryable: boolean }
```

The delta assembler stays in the daemon, is generic for extension kinds, and
ships with the conformance kit and JSON-RPC harness as
`@get-bb/plugin-sdk/provider-bridge/testing`. The ACP bridge ships as
`@get-bb/plugin-sdk/provider-bridge/acp`; the first-party ACP plugin consumes
the same kit.

## 3. Vocabulary

**Core item kinds** — the kinds core acts on:

```
message · reasoning · command · fileChange · fileRead · search · webSearch
webFetch · imageView · delegation · planSteps · compaction · tool
```

**Extension item kinds** — `"<pluginId>/<name>"`, plugin-declared schema,
validated at server ingest.

**Thread state** — core: `usage`, `contextWindow`, `rateLimits`,
`modelFallback`, `contextCleared`. Extension: `"<pluginId>/<name>"`, latest
snapshot wins per kind.

**Delegation** — one kind replaces three encodings and `thread/openWork`:

```ts
{ childRef: string, label: string, status: ItemStatus,
  background: boolean, summary?: string } // child turns link by parentRef
```

**Presentation** — attached by the bridge at `item.open`, persisted with the
item so it renders after the plugin is uninstalled or upgraded:

```ts
presentation: {
  label: { pending: string, completed: string },
  icon: { glyph: string } | { asset: string },
  title?: string,       // row headline
  detail?: string,      // short markdown summary, length-capped
  suppress?: boolean,   // low-value rows (TodoWrite, ToolSearch)
  tint?: { light: string, dark: string },
}
```

Genericity rule: model fallback, context cleared, compaction skipped, and
background work stay core. Codex goals and the Codex `macos` permission
profile become codex extension kinds, with read-time conversion of persisted
rows.

## 4. Interactions

**Approvals** (closed, policy-bearing — permission modes auto-decide these):

```
command · fileChange · toolUse { tool, presentation } · permissionGrant
```

`accept-edits` approves `fileChange`; `auto` approves `command` +
`fileChange` + `toolUse`; `full` approves all.

**Requests** (open): `userQuestion` and `planReview` render with core
renderers; `"<pluginId>/<kind>"` renders with the plugin through the existing
`pendingInteraction` slot. Any bridge may raise any kind. One
interaction-lifecycle event type; the server fabricates no placeholder items.

## 5. Projection and rendering

Server-side projection folds every item, including extension items, into one
row shape:

```ts
TimelineRow { kind: string, payload, presentation }
```

No tool-name tables, no arg-field guessing, no `tool_name` virtual column. A
plugin renders its own extension kinds and the generic `tool` items its
provider emitted:

```ts
app.slots.timelineRenderer({ kind, component })
// component props: { row, payload, presentation, thread, Original }
```

Core kinds always use core renderers, customized through `presentation` only.
Provider frontend bundles load lazily on the first thread of that provider and
never enter the boot payload. Mobile renders the declarative base for every
kind.

The provider directory is available to plugins through `app.useProviders()`
(frontend) and `bb.sdk.providers` (backend); no plugin re-vendors provider
names or icons.

## 6. Distribution

Bridges are delivered as content-addressed plugin artifacts the daemon caches
by verified hash. There is no daemon-bundled provider path: a first-party
provider ships the same way a marketplace provider does. Trust is installation
trust, identical to every other plugin.
