# Provider plugin API

This document is the reference for BB's provider plugin surface — what "a
provider is a plugin" means. It has no phases: every change that touches this
surface keeps it true, and a test (`packages/plugin-sdk/src/__tests__/
provider-plugin-doc.test.ts`) checks its code blocks against the real types.
Members that still carry the `experimental_` prefix are named with it here;
each has an entry in [api_to_audit.md](api_to_audit.md) saying why.

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
  family: undefined,             // optional grouping key (the ACP agents share one)
  icon: "./icons/claude.svg",    // a plugin SVG, served as logoUrl; a glyph name; or "<pluginId>/<name>"
  strings: {
    signInHint: "Run `claude` on the machine to sign in.",
    expiredHint: "Your Claude session expired. Run `claude`, then reload.",
    installUrl: "https://docs.anthropic.com/claude-code",
    brandPrefix: "Claude ",      // optional; stripped from model display names
    planModeCopy: undefined,     // optional; plan-mode banner copy
    iconTint: undefined,         // optional { light, dark }
  },
  maintenance: { health: true, usage: true, installation: true }, // each defaults to false
  capabilities: {                // pre-session facts, one client shape: ProviderInfo
    permissionModes: ["accept-edits", "auto", "full"], // closed core enum
    fork: "checkpoint",          // "none" | "tip" | "checkpoint"
    supportsNativeUserQuestion: true,
    supportsManualCompaction: true,
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsServiceTier: false,
    reasoningLevels: ["low", "high"], // the coarse ladder; `reasoningLevels` below is precise
  },
  reasoningLevels: [             // picker options; model/list is precise
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
  serviceTiers: undefined,       // optional; open list, model/list is precise
  composerActions: ["plan"],     // "plan" | "goal"
  extensionKinds: {},            // "<name>": { item?: Schema, state?: Schema }
  models: { fallback: [], scope: "host" }, // cold-cache placeholder; scope is
                                 // "host" | "workspace" (default): how far one
                                 // model/list answer travels
  env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
  deriveProviderOptions(ctx) {   // called on every command
    // ctx: { threadId, projectId, model, permissionMode, promptMode?, settings }
    return {};                   // opaque JSON handed to this plugin's bridge
  },
})
// => { dispose(): void }
```

Still experimental on the declaration (see api_to_audit.md):
`experimental_visibility` (`"installed"` hides the row until the bridge's
health probe finds the agent), `experimental_bridgeOptions` (immutable JSON
forwarded opaquely to the bridge), `experimental_nativeSkillRoots` and
`experimental_nativeCommandRoots` (where the agent keeps its own skills and
slash commands; each root is a path or `{ path, recursive?, ancestors?,
namePrefix?, skipIfManifest? }`, where `recursive` scans nested skill
directories, `ancestors` (project roots only) also scans the same relative
directory in every ancestor of the workspace up to the repository root,
`namePrefix` is prepended to every name under the root, and `skipIfManifest`
names the marker file whose presence makes bb skip a directory as a vendor
plugin rather than a skill; a symlink out of a project root is followed
within the workspace for a plain root and within the repository root for a
root that walks ancestors or that the plugin resolved) and
`experimental_resolvesNativeRoots` (the plugin's `bb.host`
entry answers `resolveNativeRoots({ providerId, cwd })` with the roots only
that host and workspace know: a moved config directory, installed vendor
plugins, config-file entries; an answer lists each path once per side, and
the `@get-bb/plugin-sdk/host` vendor-plugin readers keep the first root per
path in answer order). Declared roots are relative to the host home
(`user`) or the workspace (`project`) only; a host-absolute directory is
always the resolver's answer. bb scans each absolute path once per provider
across the declared and resolved roots: the first root in declaration order
wins — declared skills (project, then user), declared commands, then the
resolved skills and commands, each in the order given — and a later root with
the same path is dropped, so a resolved root that repeats a declared one is
listed under the declared root's identity.

Rules:

- Capabilities project to exactly one client shape, `ProviderInfo`.
  `ProviderInfo.maintenance` is the one shape of the three maintenance facts;
  clients ship with the server, so nothing is served beside it.
- The plugin learns per-instance truth itself (probe through its own host RPC,
  register conservatively while the host is offline, re-register on connect).
- Picker order and the default provider are user settings; the initial default
  is plugin install order. First-party plugins install first at bootstrap.
- Third-party ACP agents (for example Amp) register the same way, with a
  bridge built from the published ACP kit.

## 2. Bridge (plugin `bb.host` artifact, runs on the host)

```ts
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine, start, onClose,
})
```

The export name and `experimental_defineProviderBridge` / `experimental_apiVersion`
are the artifact contract the daemon bootstrap reads from every installed
plugin; they keep their prefix until the bridge-kit audit settles the
deprecation window between independently-updating artifacts and daemons.

One process per provider artifact; the bridge supervises any child processes.
The runtime never scopes processes per thread and never matches error text.

**Handshake** (reported per session at `initialize`, never declared):

```ts
{
  grammarVersions: [min, max],  // the delta-grammar range this bridge speaks
  sessionRestore: boolean,
  threadArchive: boolean,
  threadRename: boolean,
  threadGoalClear: boolean,
  fork: "none" | "tip" | "checkpoint",
  approvalEnforcedBy: "runtime" | "provider",
  steerMode: "inject" | "queue", // declared and recorded; nothing acts on it yet
  skills: { configure: boolean }, // the bridge handles skills/configure
}
```

`steerMode` names how the bridge delivers `turn/steer` while a turn is live
(`inject` feeds it into the running model loop, `queue` holds it for the next
prompt boundary), but nothing in the runtime, server or clients reads it yet:
the runtime sends `turn/steer` either way, and a steer whose turn is gone is
dropped on the bridge's `staleTurn` recovery hint whatever the mode.

**Runtime → bridge**: `model/list`,
`thread/{start,resume,fork,stop,discard,archive,unarchive,name/set,goal/clear}`,
`turn/{start,steer}`, `skills/configure {roots}` (only when the handshake
declares `skills.configure`),
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

See [provider-bridge-protocol.md](provider-bridge-protocol.md), "Recovery
hints", for the per-kind runtime actions and the carrier rule (a rejected
request carries the hint as `error.data.recovery`; an unsolicited one rides
the `provider/recovery` notification; never both for one event).

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
validated at server ingest. Only the declaring plugin's own providers may emit
a kind: a thread whose provider another plugin registered gets a
`provider/unhandled` in its place, as it would for a foreign presentation
glyph.

**Thread state** — core: `usage`, `contextWindow`, `rateLimits`,
`modelFallback`, `contextCleared`. Extension: `"<pluginId>/<name>"`, latest
snapshot wins per kind, same schema and emitter rules as extension items.

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
  icon: { glyph: string },  // "FileText" or "<pluginId>/<name>"
  title?: string,       // row headline
  detail?: string,      // short markdown summary, length-capped
  suppress?: boolean,   // low-value rows (TodoWrite, ToolSearch)
  tint?: { light: string, dark: string },
}
```

`icon.glyph` is a name, never bytes or a path: a host glyph (`"FileText"`)
or one of the plugin's own declared icons by its namespaced glyph
(`"<pluginId>/<name>"`, an entry of the manifest's
`bb.branding.experimental_icons` map of name → plugin-relative SVG). The
server rejects at ingest a namespaced glyph that is not the emitting
plugin's declared icon (`provider/unhandled`, reason naming the glyph); for
a `server: "bb"` tool row the emitting plugin is the one that registered
the tool, whose presentation the bridge stamps as handed to it. Clients
resolve the name against the plugin inventory they hold and draw
the SVG tinted with `currentColor`. If the plugin is gone or the name
unknown when the row renders, the icon is simply not found and the per-kind
fallback glyph draws — rows are never rewritten when a plugin changes its
map.

`tint` is a plain CSS colour per theme, and the forms every client paints are
hex, `rgb()`/`rgba()`/`hsl()`/`hsla()`/`hwb()` with a numeric alpha, and named
colours. The web also paints `oklch()`, `lab()`, `lch()`, `color()` and a
percentage alpha through CSS; React Native's colour parser does not, so on
mobile such a tint falls back to the neutral row colour (never to black).


Genericity rule: model fallback, context cleared, compaction skipped, and
background work stay core. Codex goals and the Codex `macos` permission
profile are codex extension kinds, with read-time conversion of persisted
rows.

Core keeps no table of tool names. The one exception is a quarantined
legacy-data adapter in `packages/domain/src/legacy-thread-events.ts`: a
`toolCall` row persisted before bridges stamped `presentation` upgrades at
read time to the item the bridge emits today (`fileRead` / `search`, a
suppressed bookkeeping call, a trimmed agent result). It is keyed on the
absence of `presentation`, never on a provider id, and is deleted by the
one-time backfill migration it names.

## 4. Interactions

**Approvals** (closed, policy-bearing — permission modes auto-decide these):

```
command · file_change · tool_use { tool, presentation } · permission_grant
```

`accept-edits` approves `file_change`; `auto` approves `command` +
`file_change` + `tool_use`; `full` approves all.

A `tool_use` approval is any tool call with no core kind (an MCP tool, a
provider-native tool). Its `presentation` — the same label, glyph, tint,
headline, and detail its timeline row carries — is the whole description
of the ask: the app, mobile, CLI, and the child-thread blocker summary render
it from `presentation` alone (`describePendingInteractionToolUse` in
`@bb/core-ui`), never from a tool-name table. `detail` is agent-authored
Markdown on every surface it reaches (the row body, the approval banner, on
the web and on mobile): an image in it renders as its alt text, never as a
fetch the user did not decide on.

**Requests** (open): `userQuestion` and `planReview` render with core
renderers; `"<pluginId>/<kind>"` renders with the plugin through the existing
`pendingInteraction` slot. Any bridge may raise any kind. One
interaction-lifecycle event type; the server fabricates no placeholder items.

The one event is `system/interaction/lifecycle`. Every status change of every
interaction — any approval subject, a user question, a plugin request —
appends one, carrying the interaction's lifecycle record (`@bb/domain`
`interactionLifecycleSchema`): id, status, origin, the ask, and the answer,
with the payload and the resolution paired by kind so the event cannot hold
an approval subject beside a user answer. The record keeps what a reader
needs to understand the ask and never the live ask's options
(`availableDecisions`) or a plugin form's data. The projection decides what
shows: a permission grant and a user question get a row; a command or
file-change approval shows on the provider's item, a plan review on the plan
tool call, a tool use on the tool call, a plugin request on the plugin's
form. Rows persisted under the earlier per-shape events
(`system/permissionGrant/lifecycle`, `system/userQuestion/lifecycle`) decode
into this event at read time (`convertLegacyStoredThreadEvent`). The
conversion is one-way: a server rolled back to a build before this event
fails to decode `system/interaction/lifecycle` rows, so the interactions
recorded since the upgrade lose their timeline rows until the server moves
forward again.

A bridge that keeps the payload it raised parses the wire resolution together
with it (`providerInteractionOutcomeSchema`), so its response encoder narrows
on the payload kind and a mismatched pair is a wire error, never a throw
inside the encoder.

**Raising a plugin-defined request.** A bridge sends `interaction/request`
with `payload: { kind: "<pluginId>/<name>", title, data }`, where `name` is
the id of the plugin's `pendingInteraction` slot registration and `data` is
whatever that form reads (the kind grammar is lowercase `[a-z0-9-]`, so a
form a bridge can address must register a lowercase id). No permission mode
answers a request: it reaches the user through the plugin's form on the web
app (`bb thread interactions respond <id> --value '<json>'` from the CLI;
the phone shows a card that points at the desktop app), and the answer comes
back as `{ kind: "request_answer", value }` — the form's submitted value,
capped at 64 KiB (`PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES`, the same cap on the
request's `data`). The server accepts a request only while the plugin named
by the prefix is loaded; a request for an unknown plugin is refused with an
error the bridge sees. A provider's request has no cancel; backing out stops
the turn, as with a provider's question. `value` is untrusted input to the
bridge: no form schema exists for the server to validate it against, so a
bridge parses it as it would any client-supplied JSON.

## 5. Projection and rendering

Server-side projection folds every item, including extension items, into one
row shape:

```ts
TimelineRow { kind: string, payload, presentation }
```

`payload` is a sketch, not a landed field: rows stay typed per kind and only
extension rows carry a `payload` today (`provider-plugin-doc.test.ts` keeps
the gap entry).

No tool-name tables, no arg-field guessing, no `tool_name` virtual column. A
plugin renders its own extension kinds and the generic `tool` items its
provider emitted:

```ts
app.slots.experimental_timelineRenderer({ kind, component })
// component props: { row, payload, presentation, thread, Original }
```

Core kinds always use core renderers, customized through `presentation` only.
Provider frontend bundles load lazily on the first thread of that provider and
never enter the boot payload. Everything the bundle registers arrives with it:
a settings section, nav panel, palette action, provider icon or
pending-interaction form registered from a provider plugin's `app.tsx` appears
on the first thread of one of its providers, when one of its forms is asked
for, or when its own panel route is opened — not at boot. Boot-time UI belongs
in a separate, non-provider plugin. Mobile renders the declarative base for
every kind.

The provider directory is available to plugins through
`app.experimental_useProviders()` (frontend) and `bb.sdk.providers`
(backend); no plugin re-vendors provider names or icons. Every provider's
mark is the logo its plugin declared, served as `logoUrl` and drawn as a
`currentColor` mask; core vendors no brand marks. A plugin's declared icons
(`bb.branding.experimental_icons`) reach clients the same way: the plugins
inventory carries each plugin's `icons` (name → hashed SVG URL), and both
the web timeline and mobile resolve a row's `"<pluginId>/<name>"` glyph
against it before drawing, falling back to the per-kind glyph when the name
is not found.

## 6. Distribution

Bridges are delivered as content-addressed plugin artifacts the daemon caches
by verified hash. There is no daemon-bundled provider path: a first-party
provider ships the same way a marketplace provider does. Trust is installation
trust, identical to every other plugin.

## 7. AI services

bb's helper inference (thread titles, commit messages) and voice transcription
are plugin-served too. A plugin registers
`bb.experimental_aiServices.register({ id, displayName, kinds })` and
implements `experimental_aiServicesHostContract`
(`@get-bb/plugin-sdk/ai-services`: `ai.inference.complete`,
`ai.voice.transcribe`, each carrying `serviceId`) in its `bb.host` entry. The
user chooses with `BB_INFERENCE` / `BB_TRANSCRIPTION` = `<serviceId>/<model>`;
core calls the registered plugin on the primary host and applies its own
retry/fallback policy to the `{ ok: false, code }` results. The codex plugin
serves `codex` from the codex CLI's own credentials; there is no daemon-bundled
client. Ids the server serves itself (`openai` transcription, the builtin
inference providers) are reserved: they route server-direct before the
registry and `register` refuses them; a cross-plugin id collision fails the
later plugin's load at the `register` call. See `docs/api_to_audit.md` for the
audit items.
