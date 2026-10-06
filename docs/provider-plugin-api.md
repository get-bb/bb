# Provider plugin API

This document is the contract for BB's provider plugin surface — what "a
provider is a plugin" means. Every change that touches this surface keeps it
true, and a test (`packages/plugin-sdk/src/__tests__/provider-plugin-doc.test.ts`)
checks its code blocks against the real types. Members that still carry the
`experimental_` prefix are named with it here; each has an entry in
[api_to_audit.md](api_to_audit.md) saying why. How to build, test, and ship a
provider plugin is in the bb-plugin-authoring skill
(`plugins/bb-guide/skills/bb-plugin-authoring/references/providers.md`); the
wire grammar is [provider-bridge-protocol.md](provider-bridge-protocol.md).

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
  id: "claude-code", // flat; first registration wins; no reservation
  displayName: "Claude Code",
  family: undefined, // optional grouping key (the ACP agents share one)
  icon: "./icons/claude.svg", // a plugin SVG, served as logoUrl; a glyph name; or "<pluginId>/<name>"
  strings: {
    signInHint: "Run `claude` on the machine to sign in.",
    expiredHint: "Your Claude session expired. Run `claude`, then reload.",
    installUrl: "https://docs.anthropic.com/claude-code",
    brandPrefix: "Claude ", // optional; stripped from model display names
    planModeCopy: undefined, // optional; plan-mode banner copy
    iconTint: undefined, // optional { light, dark }
  },
  maintenance: { health: true, usage: true, installation: true }, // each defaults to false
  capabilities: {
    // pre-session facts, one client shape: ProviderInfo
    permissionModes: ["accept-edits", "auto", "full"], // closed core enum
    fork: "checkpoint", // "none" | "tip" | "checkpoint"
    supportsNativeUserQuestion: true,
    supportsManualCompaction: true,
    supportsThreadArchive: true,
    supportsThreadRename: true,
    supportsServiceTier: false,
    reasoningLevels: ["low", "high"], // the coarse ladder; `reasoningLevels` below is precise
  },
  reasoningLevels: [
    // picker options; model/list is precise
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
  serviceTiers: undefined, // optional; open list of { id, label, description? },
  // "default" is the standard tier; model/list is precise
  composerActions: ["plan"], // "plan" | "goal"
  completedTurnDisplay: "flat", // "collapse" (default) | "flat"; the user's per-provider setting wins
  extensionKinds: {}, // "<name>": { item?: Schema, state?: Schema }
  models: { fallback: [], scope: "host" }, // cold-cache placeholder; scope is
  // "host" | "workspace" (default): how far one
  // model/list answer travels
  env: { passthrough: ["BB_CLAUDE_CODE_EXECUTABLE"] },
  deriveProviderOptions(ctx) {
    // called on every command
    // ctx: { threadId, projectId, model, permissionMode, promptMode?, settings }
    return {}; // opaque JSON handed to this plugin's bridge
  },
});
// => { dispose(): void }
```

Each `model/list` entry may carry `supportedServiceTiers: [{ id, label?,
description? }]`, the tiers that model accepts besides `default`. bb offers
only the ids the declaration also lists, preferring the entry's label and
description; an empty array hides the tier picker for that model, and an entry
without the field accepts every declared tier. The server rejects an explicit
tier the declaration does not list and passes the chosen id to the bridge as
`serviceTier`.

`models.fallback` is shown only until the first `model/list` probe completes,
or when a probe fails transiently; a non-empty list has exactly one
`isDefault`. bb keeps each machine's last successful `model/list` answer per
`models.scope` across daemon reconnects and server restarts, serves it
immediately, and refreshes it in the background once it is 10 minutes old.
`"host"` scope means the bridge answers from account or agent state and
ignores the workspace path, so bb probes once per machine. A stored answer is
discarded when the bridge fingerprint changes (plugin bundle digest, bridge
options, env passthrough). A list that depends on login state, CLI version, or
environment values is corrected only by the next refresh.

`env.passthrough` names the daemon environment variables the bridge may read:
provider processes are spawned with inherited `BB_*` variables stripped, and
exactly these are forwarded. `deriveProviderOptions` runs synchronously on
every session and turn command; its plain JSON result (at most 64 KiB) reaches
the bridge as `options.providerOptions`, merged over
`experimental_bridgeOptions` (a derived key replaces its static key), and core
never reads it. `ctx.settings` holds the plugin's own non-secret
`bb.settings` values.

Still experimental on the declaration (see api_to_audit.md):

- `experimental_bridgeOptions` — a plain JSON object of at most 64 KiB,
  validated and frozen at registration and carried on every bridge request.
  Use it for immutable launch facts shared by all hosts, not user settings or
  machine-local state. It participates in bridge process identity, so
  changing it starts a new bridge process for the next runtime.
- `experimental_visibility` — `"always"` (default) or `"installed"`, which
  lists the provider on a host only when its bridge's `provider/health` status
  is not `not_installed`. Such a declaration must support health; bridge
  failures hide only that provider.
- `experimental_nativeSkillRoots` and `experimental_nativeCommandRoots` —
  where the agent keeps its own skills and slash commands, at most 32 roots
  per side. Each root is a path or
  `{ path, recursive?, ancestors?, namePrefix?, skipIfManifest? }`:
  `recursive` scans nested skill
  directories, `ancestors` (project roots only) also scans the same relative
  directory in every ancestor of the workspace up to the repository root,
  `namePrefix` is prepended to every name under the root, and `skipIfManifest`
  names the marker file whose presence makes bb skip a directory as a vendor
  plugin rather than a skill. A symlink out of a project root is followed
  within the workspace for a plain root and within the repository root for a
  root that walks ancestors or that the plugin resolved. Declared roots are
  relative to the host home (`user`) or the workspace (`project`) only.
- `experimental_resolvesNativeRoots` — the plugin's `bb.host` entry answers
  `resolveNativeRoots({ providerId, cwd })` with the roots only that host
  and workspace know: a moved config directory, installed vendor plugins,
  config-file entries. A host-absolute directory is always the resolver's
  answer. An answer lists each path once per side, and the
  `@get-bb/plugin-sdk/host` vendor-plugin readers keep the first root per path
  in answer order. bb scans each absolute path once per provider across the
  declared and resolved roots: the first root in declaration order wins —
  declared skills (project, then user), declared commands, then the resolved
  skills and commands, each in the order given — and a later root with the
  same path is dropped, so a resolved root that repeats a declared one is
  listed under the declared root's identity.

Rules:

- Ids are flat and collision-rejected: the first live registration of an id
  wins, a later one from another plugin fails that plugin's load, and no id is
  reserved ahead of time. Registrations replace wholesale on reload. Disabling
  the plugin removes the provider; open threads show a provider-unavailable
  state instead of erroring.
- Capabilities project to exactly one client shape, `ProviderInfo`.
  `ProviderInfo.maintenance` is the one shape of the three maintenance facts.
- The plugin learns per-instance truth itself (probe through its own host RPC,
  register conservatively while the host is offline, re-register on connect).
- Picker order and the default provider are user settings (Settings →
  Providers, `bb settings general providerOrder '["my-agent","codex"]'`,
  `bb settings general defaultProviderId my-agent`); the initial order is
  plugin install order, bundled first-party plugins first.
- `completedTurnDisplay` is the provider's default for finished turns in the
  thread timeline. `"collapse"` folds a finished turn's work into one "Worked
  for" row beside the final answer; `"flat"` keeps every row visible, as while
  the turn ran — pick it when the agent narrates its work in text the user
  should keep reading. The user overrides it per provider in Settings →
  Providers or with `bb settings completed-turns <provider> <mode>`, and the
  server applies the result to the timeline, turn details, conversation
  outline, and `bb thread log`.
- Third-party ACP agents (for example Amp) register the same way, with a
  bridge built from the published ACP kit.

## 2. Bridge (plugin `bb.host` artifact, runs on the host)

```ts
export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start,
  onClose,
});
```

The export name and `experimental_defineProviderBridge` are the artifact
contract the daemon's bootstrap reads from every installed plugin. The
bootstrap owns the process boundary — argv, the plugin-scoped
`dataDir`/`tempDir`, bounded stdin framing, and signals — so importing the
module must start nothing.

One process per provider artifact; the bridge supervises any child processes.
The runtime never scopes processes per thread and never matches error text.

**Handshake** (reported per session at `initialize`, never declared; field
semantics in [provider-bridge-protocol.md](provider-bridge-protocol.md),
"Versioning and capabilities"):

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

**Runtime → bridge**: `initialize`, `model/list`,
`thread/{start,resume,fork,stop,discard,archive,unarchive,name/set,goal/clear}`,
`turn/{start,steer}`, `skills/configure {roots}` (only when the handshake
declares `skills.configure`),
`provider/{health,usage,installation/status,installation/run}`.

Execution options ride every command and carry no provider-named field:

```ts
{ model, serviceTier?, reasoningLevel, promptMode?, instructions,
  providerOptions: JsonValue } & PermissionPolicy
```

**Bridge → runtime**: notifications `thread/delta` (one streaming dialect, one
usage dialect), `thread/identity`, `session/replaced`, `provider/recovery`,
`provider/raw`, and `error`, plus the request channels `item/tool/call` and
`interaction/request`.

Recovery is typed, never text-matched:

```ts
// provider/recovery
{ kind: "sessionArchived" | "authRequired" | "restartRecommended"
       | "staleTurn" | "rateLimited",
  message: string, retryable: boolean }
```

See [provider-bridge-protocol.md](provider-bridge-protocol.md), "Recovery
hints", for the per-kind runtime actions and the carrier rule.

The delta assembler runs in the daemon and is generic for extension kinds. It
ships with the conformance kit and JSON-RPC harness as
`@get-bb/plugin-sdk/provider-bridge/testing`; the ACP bridge ships as
`@get-bb/plugin-sdk/provider-bridge/acp`.

## 3. Vocabulary

**Core item kinds** — the kinds core acts on:

```
message · reasoning · plan · command · fileChange · fileRead · search
webSearch · webFetch · imageView · imageGeneration · backgroundTask
delegation · planSteps · compaction · tool
```

**Extension item kinds** — `"<pluginId>/<name>"`, declared in
`extensionKinds` with an item schema, a state schema, or both, and validated
at server ingest; a payload that fails validation persists as a
`provider/unhandled`. Only the declaring plugin's own providers may emit a
kind: a thread whose provider another plugin registered gets a
`provider/unhandled` in its place, as it would for a foreign presentation
glyph.

**Thread state** — core: `usage`, `contextWindow`, `rateLimits`,
`modelFallback`, `contextCleared`. Extension: `"<pluginId>/<name>"`, latest
snapshot wins per kind, same schema and emitter rules as extension items.

**Delegation** — one kind for every sub-agent encoding:

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
`bb.branding.experimental_icons`). The server rejects at ingest a namespaced
glyph that is not the emitting plugin's declared icon (`provider/unhandled`,
reason naming the glyph); for a `server: "bb"` tool row the emitting plugin is
the one that registered the tool, whose presentation the bridge stamps as
handed to it. Clients resolve the name against the plugin inventory they hold
and draw the SVG tinted with `currentColor`. If the plugin is gone or the name
unknown when the row renders, the per-kind fallback glyph draws — rows are
never rewritten when a plugin changes its map.

`tint` is a plain CSS colour per theme, and the forms every client paints are
hex, `rgb()`/`rgba()`/`hsl()`/`hsla()`/`hwb()` with a numeric alpha, and named
colours. The web also paints `oklch()`, `lab()`, `lch()`, `color()` and a
percentage alpha through CSS; React Native's colour parser does not, so on
mobile such a tint falls back to the neutral row colour (never to black).

Genericity rule: model fallback, context cleared, compaction skipped, and
background work stay core. Provider-specific concepts (Codex goals, the Codex
`macos` permission profile) are that plugin's extension kinds. Core keeps no
table of tool names.

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
it from `presentation` alone, never from a tool-name table. `detail` is
agent-authored Markdown on every surface it reaches (the row body, the
approval banner, on the web and on mobile): an image in it renders as its alt
text, never as a fetch the user did not decide on.

**Requests** (open): `userQuestion` and `planReview` render with core
renderers; `"<pluginId>/<kind>"` renders with the plugin through the existing
`pendingInteraction` slot. Any bridge may raise any kind. The server
fabricates no placeholder items.

Every status change of every interaction — any approval subject, a user
question, a plugin request — appends one `system/interaction/lifecycle`
event carrying the interaction's lifecycle record: id, status, origin, the
ask, and the answer, with the payload and the resolution paired by kind so the
event cannot hold an approval subject beside a user answer. The record keeps
what a reader needs to understand the ask and never the live ask's options
(`availableDecisions`) or a plugin form's data. The projection decides what
shows: a permission grant and a user question get a row; a command or
file-change approval shows on the provider's item, a plan review on the plan
tool call, a tool use on the tool call, a plugin request on the plugin's
form.

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
app.slots.experimental_timelineRenderer({ kind, component });
// component props: { row, payload, presentation, thread, Original }
```

Core kinds always use core renderers, customized through `presentation` only.
A provider plugin's frontend bundle loads like every other plugin's: in the
deferred boot pass after the first route paints, not on first paint and not
only when one of its providers is in use. Everything its `app.tsx` registers —
a settings section, nav panel, palette action, provider icon,
pending-interaction form, or `app.composer.customize` chrome — is present from
that boot pass on, including on the New Thread page; until then the served
logo stands in for a registered provider icon. Keep the bundle small: it ships
to every window whether or not the provider is selected. Mobile renders the
declarative base for every kind.

The provider directory is available to plugins through
`app.experimental_useProviders()` (frontend) and `bb.sdk.providers`
(backend); no plugin re-vendors provider names or icons. Every provider's
mark is the icon its plugin declared — a path or declared icon served as
`logoUrl` and drawn as a `currentColor` mask, or a host glyph name; core
vendors no brand marks.

## 6. Distribution

Bridges are delivered as content-addressed plugin artifacts. On install or
reload the server builds `dist/host.js` and records its digest; thread
commands carry `{pluginId, digest}`, and the host daemon downloads the
bytes, verifies the digest before caching them, and runs the artifact with
its own node. It is the same artifact and cache as the plugin's host RPC
entry. There is no daemon-bundled provider path: a first-party provider ships
the same way a marketplace provider does. Trust is installation trust,
identical to every other plugin: a bridge runs only for an installed, enabled
plugin, and only on hosts its server instructs.

## 7. AI services

Helper tasks (thread titles, commit messages, voice transcripts) are
plugin-served through `bb.experimental_aiServices`, documented in the
bb-plugin-authoring skill's `backend-cli-agents.md`.
