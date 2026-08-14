# Agent Providers as a First-Class Plugin Surface

## Goal

Make agent providers a plugin surface in two senses:

1. **Declaration**: every provider declares itself through the plugin API —
   id, display name, icon, kind (e.g. a future `router` that delegates to
   other providers), capabilities, and launch metadata.
2. **Runtime**: plugins register a **provider bridge** — a process that
   implements one bb-owned, provider-agnostic JSON-RPC protocol. The bb core
   (server policy, daemon runtime, UI) speaks only that protocol and reads
   only declared metadata.

Built-in providers (codex, claude-code, pi, cursor/ACP) are re-shipped as
first-party plugins. The core becomes provider-agnostic; new providers get a
first-class path that is not constrained by ACP.

## Current State (2026-08-14)

The provider "contract" today is six scattered surfaces:

1. **Catalog** — `packages/agent-providers/src/catalog.ts`: closed enum
   (`codex`, `claude-code`, `pi`, `acp-cursor`), wire-facing `ProviderInfo`
   (capabilities, composer actions, `logoUrl` — null for all built-ins) plus
   backend-only `ProviderServerCapabilities`. Imported by server policy, the
   runtime, `@bb/config`, **and the app bundle** (three files:
   `system-queries.ts`, `provider-icon.ts`, `fork-thread-request.ts`).
2. **Adapter** — `packages/agent-runtime/src/{codex,claude-code,pi,acp}/`:
   the 18-member in-process `ProviderAdapter`
   (`packages/agent-runtime/src/provider-adapter.ts`), 4.4k–9.4k lines per
   provider. Three of four already spawn a bb-authored **bridge** Node bundle
   over line-delimited JSON-RPC (`shared/bridge-harness.ts`); codex spawns
   `codex app-server` directly and translates its native protocol in-core
   (no bb-authored bridge). Event translation, schemas,
   visibility, and model parsing live **in core**, per provider.
3. **Registry wiring** — `packages/agent-runtime/src/provider-registry.ts`.
4. **Daemon host-local tables** — `apps/host-daemon/src/provider-cli-health.ts`
   (executables, install/update commands), `injected-skills.ts` (skill-root
   layout), `command-handlers/list-commands.ts::PROVIDER_SKILL_SPECS`
   (largest per-provider table, 8 ids).
5. **UI metadata** — hardcoded icon/color maps in three places:
   `apps/app/src/lib/provider-icon.ts`, plus duplicates in
   `plugins/tasks/views/activity/provider-logo.tsx` and
   `plugins/automations/lib/provider-icon.tsx`; `logoUrl` honored at only
   one of seven app icon call sites.
6. **Scattered enums/lists** — `supportsManualCompaction` string list,
   `skillProviderSchema` (`packages/server-contract/src/api/projects.ts`),
   `providerCliKeyValues` + fixed-key `providerUsageResponseSchema`
   (`packages/host-daemon-contract`), `thread-timeline-active-prompt-mode`
   enum (`packages/domain`), `EDIT_MESSAGE_PROVIDER_IDS`
   (`apps/server/src/services/threads/thread-edit-message.ts`), onboarding
   provider list, `SETTINGS_PROVIDER_ENTRIES`, usage-limits UI, provider
   switches in `packages/thread-view`, Claude-only fields on the shared
   `ProviderExecutionContext` (`claudeCodePermissionMode`,
   `claudeCodeMockCliTraffic`).

**ACP** is the only extension point: a pure-data launch spec
(`hostDaemonAcpLaunchSpecSchema`) resolved per command — from `config.json`
for custom agents, from the in-repo `KNOWN_ACP_AGENTS` table (a code change)
for known ones — and run by the generic ACP bridge. It works, but the path
is deliberately least-common-denominator: no `auto` permission mode
(ACP threads default to `full`), no token usage, no plan/goal composer
modes, no command-shaped scan roots (native *skill* typeahead does work),
degraded approvals/models/reasoning, config-file-only setup, no settings UI.
(Fork landed 2026-08-14 via `53d193144`: the bridge negotiates the agent's
unstable `session/fork` capability at initialize and rejects agents that
don't advertise it — the declare-coarse-then-handshake-narrows pattern this
plan proposes generally. Tip-only: ACP `session/fork` clones the whole
source session and cannot stop at a checkpoint, so checkpoint forks are
rejected and edit-message rewind stays unsupported — fork ≠ rewind, which is
why `supportsNativeFork` and `supportsNativeSessionRewind` are separate
capabilities here.)

**Plugin backends** run in-process in the server (frontends ship as app
bundles). The host daemon has **zero**
plugin extension points; a plugin reaches a host only through `bb.sdk` routes
or the shared-port control plane. Plugin registration surfaces, artifact
management (`managed-plugin-artifacts.ts`), builtin auto-install
(`builtin-registry.ts`), asset serving, and the `experimental_` +
`docs/api_to_audit.md` convention all exist and are reusable here.

**Wire facts**: the DB and thread domain schemas store `providerId` as a free
string (the closed vocabularies are the catalog enum plus the stray enums in
item 6); `HOST_DAEMON_PROTOCOL_VERSION` is 122
and has been bumped by **88 commits since 2026-06-01** (26 → 122; 121→122
landed while this plan was being written) — provider behavior is
tightly coupled to daemon deploys, which this plan explicitly decouples.

## Lessons from past incidents → design requirements

From the incident archive (issues/PRs/commits touching providers). Each lesson
becomes a concrete property of the new design; the conformance kit (below)
encodes the testable ones.

| Lesson (incident) | Design requirement |
| --- | --- |
| 87 protocol bumps in ~14 months (26 → 121); translation fixes require daemon deploys | Bridges version independently of the daemon. `initialize` negotiates `{protocolVersion, capabilities}` both ways; unknown methods/fields degrade, never crash. |
| Idle reaping was Codex-only by accident (#1604); process-key scheme encoded eligibility | Declaration carries explicit `processScope: "thread" \| "shared"` and `sessionPersistence: "none" \| "resume"`; reap eligibility derives from declared data, not string prefixes. |
| Release vs interrupt conflated (#1584) | Protocol `thread/stop` carries `intent: "interrupt" \| "release"` from day one. |
| Turn settlement gaps — repeated fixes (#1196, #1234, #1321, #1432), still no watchdog | Runtime (single owner of the turn state machine) keeps the accepted→dispatched→started→completed states; add the missing **turn-start watchdog** (visible failure if no `turn/started` within a bound). |
| Session replaced as silent side effect of config diff (#1268, #1236) | No core-side option diffing at all: the bridge owns reconciliation, and session replacement must be **reported** (session-replacement notification + settlement events), never silent. |
| Provider-minted ids trusted as bb ids froze a host for 30 min (#1320) | Protocol schema forbids the bridge from minting bb turn ids; only caller-vouched ids scope events. Diagnostic events are droppable by construction. |
| Silently dropped undecodable JSON-RPC → 30s timeouts (#853) | Conformance rule: undecodable → `-32602` reply with issues; unknown method → `-32601`; request/response discriminated on `method`. |
| Per-session item-id counters collided across resumes → permanent 500 (#1224) | Conformance rule: item ids unique across resume (turn-scoped with per-instance entropy); projection degrades, never throws. |
| Normalized events with divergent shapes: pi/claude/acp open assistant text with bare `item/agentMessage/delta`, no `item/started`; timeline window cuts dropped the earlier deltas (fix in flight: `6e4628e9e`) | Conformance rule: every item's first event is `item/started` — bridges synthesize it when their SDK streams delta-first. The projection backfill stays for persisted history but becomes legacy-only. |
| One bad entry or unknown enum member took down whole listings (#1044 null-for-absent, #580 new enum members, #1148 throwing extension loader) | Protocol schemas are lenient at the edge (soft-parse unknown enum members, null-tolerant); one malformed entry degrades to one missing entry. |
| Ambient env leaks (`BB_THREAD_STORAGE`, Volta, Electron, fnm churn) (#1366, #1545, #1156) | Bridge env is **constructed by one allowlist function**; the daemon's own env is not reachable from provider-facing code. |
| Same binary name, wrong CLI (#1231); launch drift not in process key | Process identity = hash(bridge artifact + declared exec inputs + env overrides + providerId), generalizing the ACP fingerprint to every provider. |
| Cross-provider features shipped to half the matrix (#1374: rate limits 2/4, compaction 19 commits) | One implementation site: a feature is a protocol method + declared capability; participation is machine-checkable, not grep. |
| One shared decoder bug hit three bridges at once (#853) | The shared protocol library gets tests proportional to fan-out: the conformance kit runs against **every** bridge in CI. |

## Design

### 1. The bb Provider Bridge Protocol

A new package, `@bb/provider-bridge-protocol`: zod schemas + TypeScript types
for every message in both directions, plus a doc
(`docs/provider-bridge-protocol.md`). This is a formalization of what already
exists, not an invention:

- **Runtime → bridge requests** (today's `AdapterCommand` union, now with
  fixed method names and schemas): `initialize`, `model/list`,
  `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer`,
  `thread/stop` (with `intent`), `thread/discard`, `thread/name/set`,
  `thread/archive`, `thread/unarchive`, `thread/goal/clear`,
  `skills/configure`.
- **Bridge → runtime notifications**: normalized bb `ThreadEvent` envelopes
  (the "normalized codec" in `shared/standard-adapter-members.ts` +
  `shared/json-rpc-envelope.ts` is the starting point: `thread/event`,
  `thread/identity`, `thread/contextWindowUsage`, `thread/tokenUsage`,
  `error`), plus a droppable `provider/raw` diagnostic channel that replaces
  in-core visibility classification.
- **Bridge → runtime requests**: `item/tool/call` (dynamic plugin tools),
  interactive/permission requests using the canonical
  `PendingInteractionPayload` union from `@bb/domain`
  (`packages/domain/src/pending-interactions.ts`).
- **Handshake**: `initialize` exchanges `{protocolVersion, capabilities}` in
  both directions. Optional capabilities cover the long tail: usage reporting,
  rate-limit state (`ProviderRateLimitState` is already a normalized domain
  type, but only claude/codex translation produces it — the #1374 "2 of 4"
  example; promoting it into the protocol event schema lets any bridge join
  and feeds the provider-retry plugin unchanged), compaction, host AI
  services (voice transcription / structured inference — today's codex-only
  daemon commands), fork, archive, CLI lifecycle.
- **CLI lifecycle lives in the bridge, not the declaration**: optional
  `provider/health` (installed?, version, auth state, login command),
  `provider/install`, and `provider/update` methods replace the daemon's
  per-provider CLI tables (`provider-cli-health.ts`,
  `known_acp_agents.status`). No chicken-and-egg: the bridge is bb-authored
  code that runs whether or not the provider CLI is installed, so the daemon
  can spawn it one-shot for probes and cache the result (invalidated on
  install/update — the #945 lesson). Probing from inside the bridge means
  detection uses the exact environment and executable resolution that
  launching uses, making the status-disagrees-with-launch bug class
  (#1388 PATH asymmetry, #1231 same-named wrong CLI) unrepresentable, and it
  keeps version-compatibility knowledge (minimum supported CLI version) next
  to the translation code that actually depends on it. It also avoids
  encoding install strategies as a declarative mini-DSL
  (`npmGlobal` / `downloadedShellScript` / …) that would grow provider
  variants inside core again.
- **Skills live in the bridge too, in both directions.** *Injection*
  (bb skills → provider): `skills/configure` carries one canonical payload —
  the staged catalog root plus skill descriptors — and each bridge
  transforms it into its provider's native shape (claude-code writes its
  plugin directory + generated manifest, codex/pi point at the skills
  directory, acp builds its prompt listing). This deletes today's
  three-layer per-provider switch in core: `injected-skills.ts::buildSkillRoots`
  (four hardcoded shapes), the `runtime-skill-roots.ts` normalize/filter
  switch, and the four-variant skill-root union in `agent-runtime/types.ts`.
  The daemon keeps only the generic content-addressed staging (symlink-safe
  copy, hashing), which is genuinely host infrastructure. *Discovery*
  (provider-native skills → composer typeahead): an optional
  `skills/scanRoots {cwd}` method returns the provider's resolved scan
  roots; the daemon keeps the generic scanner/parser. The
  `PROVIDER_SKILL_SPECS` table this replaces is not actually stable data —
  its `userLocations` are functions of resolved config dirs (`CODEX_HOME`,
  Claude config-dir override, `OPENCODE_CONFIG_DIR`), acp-grok has compat
  rules read from grok's own config file plus env toggles, root ordering
  differs per provider, and claude-code appends `.claude/commands` roots
  with a different shape — i.e. it is code, which is exactly what belongs
  behind the bridge. Composer typeahead stays fast via a daemon cache keyed
  by (bridge artifact hash, cwd), answered by a resident session's bridge
  when one exists and a one-shot spawn otherwise.

The key semantic change vs today: **all translation moves into the bridge**.
The bridge emits bb `ThreadEvent`s; the runtime never sees provider-native
payloads. `buildCommandPlan`, `translateEvent`, `parseModelListResult`,
`decode*Request` all disappear from core.

### 2. What remains in core

`packages/agent-runtime` keeps exactly the provider-agnostic machinery, with
**one** generic `BridgeProviderAdapter` replacing the four bespoke adapters:

- process lifecycle (`runtime-provider-process.ts`), spawn with allowlisted env
- the turn state machine + new turn-start watchdog
- thread/session/process identity registries
- permission policy enforcement (auto-deny, escalation clamping)
- skill catalog hand-off (`skills/configure`), event queueing to the server
- execution-option forwarding: the runtime never diffs options or
  orchestrates session rebuilds — options ride every command, the bridge
  reconciles internally, and rebuilds surface as explicit notifications

Disposition of every current `ProviderAdapter` member:

| Member | Becomes |
| --- | --- |
| `id`, `displayName`, `capabilities` | declaration data |
| `approvalRequestPolicy` | declaration field |
| `process` | uniform: `node <bridge entry>` from the bridge ref |
| `buildCommandPlan` | deleted — fixed protocol methods; the bridge maps internally |
| `translateEvent`, `translateAcceptedCommand` | deleted — bridge emits `ThreadEvent`s (accepted-user-message synthesis stays generic in runtime) |
| `parseModelListResult` | deleted — protocol defines the `model/list` result schema |
| `decodeToolCallRequest`, `decodeInteractiveRequest`, `buildInteractiveResponse` | deleted — canonical protocol schemas |
| `classifyExecutionSettingsChange` | deleted with no replacement — the runtime never diffs options; the bridge reconciles internally, and rebuild visibility is the mandatory session-replacement notification. No declared scope table: #1610 removed its last server-side consumer (see the note in Design §3) |
| `normalizeExecutionOptions` | deleted — bridge-internal normalization |
| `buildPostInitializeRequests`, `prepareTurnStart`, `clearActiveTurnState` | deleted — bridge-internal or generic turn-state concerns |
| `buildThreadDetachedEvents` | generic: runtime reconciles from its own background-work state |
| per-provider `visibility.ts` | deleted — bridge classifies before emitting `provider/raw` |

`ProviderExecutionContext` sheds every provider-flavored field.
`claudeCodePermissionMode` becomes the declared prompt-mode capability + a
normalized field; `claudeCodeMockCliTraffic` becomes a bridge-test-harness
concern inside the claude plugin; and `workflowsEnabled` / `memoryEnabled` /
`providerSubagentsEnabled` — claude-specific knobs riding the shared
contract today — move to **provider-scoped session options**: opaque data a
provider plugin derives from its own settings, which core passes through to
that provider's bridge untouched (the `acpLaunchSpec` precedent,
generalized). Core stays agnostic; the plugin owns setting, delivery, and
enforcement end to end.

### 3. The declaration (plugin surface)

A new method on the existing `bb.agents` plugin namespace, per the
stability convention shipped as
`bb.agents.experimental_registerProvider(declaration): { dispose() }` with an
entry in `docs/api_to_audit.md`. A plugin may register several providers
(the ACP plugin does) and re-register on settings change; registrations are
replaced wholesale on plugin reload, like every other surface.

Sketch (final shape settled during implementation):

```ts
bb.agents.experimental_registerProvider({
  id: "claude-code",                    // stable; existing ids unchanged
  displayName: "Claude Code",
  icon: { asset: "icons/claude.svg" },  // served via existing plugin assets
  kind: "agent",                        // "agent" | "router" — see router note below
  capabilities: {
    // One merged block: today's ProviderCapabilities + ProviderServerCapabilities.
    // Every boolean declares a provider-native fact, and a fact earns a slot
    // here ONLY when a consumer outside the provider's own plugin needs it
    // (e.g. supportsNativeUserQuestion: the ask-user-question plugin must
    // know it to skip its duplicate tool). Facts only the provider's own
    // plugin consumes do NOT belong here — today's `supportsWorkflows` is
    // the example: its one consumer computes `workflowsEnabled` =
    // capability && !claudeCodeWorkflowsDisabled, a bit only the claude
    // bridge reads (its PreToolUse hook gates the native Workflow tool) and
    // every other provider ignores. That whole chain moves inside the
    // claude plugin: the toggle becomes a claude-plugin setting, delivered
    // to its bridge as provider-scoped session options (below), and both
    // the capability and the shared `workflowsEnabled` wire field are
    // deleted. (bb's own provider-independent workflows plugin needs no
    // capability either; it registers plain plugin tools with no provider
    // check.)
    supportsNativeFork: true,          // clone a session at a branch point
    supportsNativeUserQuestion: true,  // ships its own ask-the-user tool (bb's
                                       // plugin fallback tool is skipped)
    supportsNativeSessionRewind: true, // session rewinds to an earlier point;
                                       // gates bb's edit-past-message feature
    supportsSessionArchiveSync: false, // mirror bb archive state into the
                                       // provider's own session list
    supportsSessionNameSync: false,    // push bb thread titles to the provider
    supportsManualCompaction: true,    // explicit context compaction
    supportsServiceTier: false,        // fast/priority tier toggle
    supportsHostAiServices: false,     // backs voice transcription / inference

    // Enumerations
    permissionModes: ["accept-edits", "auto", "full"],
    reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    promptModes: ["plan"],
    sessionPersistence: "resume",       // reap/resume eligibility. Shipped on
                                       // main as a two-level design this
                                       // field absorbs: declared default
                                       // (`supportsSessionRestore`,
                                       // `3bc9ce54b`) refined per session by
                                       // the `sessionRestorable` flag on
                                       // thread-identity results (ACP reads
                                       // the agent's `loadSession` at
                                       // initialize; kept fresh across
                                       // session replacement).
    processScope: "shared",             // "thread" (codex) | "shared"
  },
  composerActions: [...],
  approvalRequestPolicy: "provider",
  // NOTE: there is deliberately NO `executionOptionScopes` (or any
  // live-vs-session cost table). Its would-be consumers are all gone:
  // #1610 deleted the override gate and `supportsExecutionOverride`; the
  // runtime never diffs options (the bridge reconciles internally); and
  // the truth-telling duty is event-sourced where it already works today —
  // the ACP bridge warns at the moment a resume falls back to a fresh
  // session ("continuing in a fresh session without in-agent history",
  // `acp/bridge/bridge.ts:1618`), and this protocol makes the equivalent
  // universal via the mandatory session-replacement notification. A
  // declared table with zero consumers would violate the repo's own
  // contract rules (accepted-but-ignored fields are forbidden). If a
  // pre-submit "this will rebuild the session" hint is ever wanted, source
  // the per-option scopes from the bridge's `initialize` result and add
  // the declaration field when that consumer exists — deleting now
  // forecloses nothing.
  // Per-provider reality of a mid-thread model/reasoning change, from the
  // code: claude applies live; codex takes model/serviceTier per turn
  // (`codex/adapter.ts:2094`) and bb's extra same-process `thread/resume`
  // is redundant conservatism; pi resumes same-process with the new
  // settings; acp is lossy only without `loadSession` — and warns.
  bridge: { entry: "provider-bridge" }, // required for kind "agent"; routers omit it
  // NOTE: no `cli` and no `skillRoots` blocks — CLI lifecycle and skill
  // layout knowledge are bridge protocol methods, not declaration data. See
  // "CLI lifecycle lives in the bridge" and "Skills live in the bridge".
});
```

Server side, a new `ProviderRegistryService` becomes the single source of
provider metadata. Every current consumer of `@bb/agent-providers`
(execution options, thread default policy, reasoning policy, permission
ceiling, fork/compaction gates, typeahead, onboarding) reads from it.
`ProviderInfo` gains `kind`, and built-ins finally populate the existing
`logoUrl` field (plugin asset URL); all three hardcoded icon maps (app,
tasks plugin, automations plugin) die, and every icon call site reads
`logoUrl`. The app stops importing `@bb/agent-providers` entirely (the speculative
execution-options placeholder switches to last-known server data).

**Routers.** A provider entry is ultimately a picker option that resolves
into thread execution params at submit time. A `kind: "router"` provider
makes that resolution *indirect*: it appears in the model/reasoning pickers
like any other provider, but it never executes anything itself — its
selection resolves to another registered provider's (model, reasoning) pair,
and the thread runs on that delegate's bridge. Two future archetypes
(neither built in this change):

- **Auto router**: a single "Auto" picker entry; a user-authored routing
  prompt in the plugin's settings resolves each submission dynamically
  ("frontend work → Claude Code Opus, everything else → Codex 5.6-sol").
- **Preset router**: the user's few favorite (provider, model, reasoning)
  pairs as a compact picker list — e.g. just "Codex xhigh" and "Opus 5
  xhigh" — so the existing cycle-model keyboard shortcuts flip between
  complete pairs without opening the picker and re-selecting provider →
  model → reasoning. Entries come from the plugin's settings; each pair
  models naturally as a "model" with a single supported reasoning effort,
  so existing picker and cycling mechanics work unchanged.

Consequences for this change:

- `kind: "agent"` **requires** `bridge`; `kind: "router"` **omits** it
  (declaration validation enforces both directions). Every regular provider
  ships a bridge that runs on the host and implements the protocol.
- Router picker entries are **server-supplied** (declaration data, refreshed
  on plugin settings change): with no bridge there is no host-side
  `model/list`. The provider registry / execution-options path must support
  server-supplied entries rather than assuming every model list arrives from
  a daemon probe.
- Resolution is server-side product policy (plugins run in the server; the
  daemon only ever sees the resolved delegate). Preset entries resolve
  statically from entry data; the auto router additionally needs a
  `resolveExecution(submission) → {providerId, model, reasoningLevel}` hook.
  Neither ships in this change — the declaration shape, `ProviderInfo`
  `kind`, and the bridge-optional rule just leave room for both.
- When the hooks ship, the thread executes and persists as the *delegate*
  provider; the router id lives in the composer's sticky selection, not in
  thread execution state. Noted here so the registry design doesn't
  preclude that split.

### 4. Bridge delivery to hosts

Bridges execute on the host (daemon side, per the server/daemon boundary:
translation and session management are host-local). Plugins live in the
server. The delivery mechanism:

- `bb plugin build` gains a third target: `dist/provider-bridge.mjs`
  (node-platform ESM bundle, same esbuild setup as `server.js`; this is how
  in-repo bridges are already bundled).
- The server stores bridge bundles as content-addressed managed artifacts
  (existing `managed-plugin-artifacts.ts` machinery).
- The session payload's `acpLaunchSpec` slot generalizes to a provider launch
  spec: `{providerId, bridge: {hash, source}, declaredRuntimeData}` where
  `source` is `bundled` (shipped inside the daemon build — the transition
  state and first-party fast path) or `artifact` (daemon downloads from the
  server by hash over its existing connection, caches under its data dir,
  verifies the hash). **This is the one `HOST_DAEMON_PROTOCOL_VERSION` bump
  in the whole plan.**
- Trust model: identical to plugins and `customAcpAgents` today —
  installation trust. A bridge runs only for an installed, enabled plugin;
  the daemon executes only what its server instructs. Documented loudly in
  the plugin authoring guide.

## Phases

Each phase lands as normal PRs on main, all tests green, no long-lived
branch. Provider ids never change, so there is no data migration anywhere.

### Phase 1 — Freeze the protocol (core only, no wire changes)

- Create `@bb/provider-bridge-protocol` (schemas + doc) from the existing
  normalized codec, `acp/bridge-protocol.ts`, the envelope/tool-call shapes
  in `agent-runtime/src/shared/`, and the pending-interaction payload union
  in `@bb/domain`.
- Build the **conformance kit**: a black-box test suite that drives any
  bridge binary through the full lifecycle (initialize handshake, start,
  turn, steer, permission request, resume, fork-or-declared-absence, stop
  with both intents, fork checkpoint-vs-tip granularity,
  malformed-message replies, item-id uniqueness across
  resume, item lifecycle ordering — every item opens with `item/started`,
  delta-first openings are non-conformant — and the env allowlist). It
  encodes the incident-derived rules above.
- The protocol doc gets an explicit **event-grammar section** — today the
  event vocabulary is structurally schema'd but its sequences are implicit
  (per-adapter conventions, comments, and consumer defensiveness), and every
  unstated rule has been discovered by its violation. State the turn
  lifecycle state machine, the item lifecycle, which orderings producers
  guarantee vs which consumers must never assume, and id scoping.
  Enforcement lives in two places with different strictness: the conformance
  kit checks grammar behaviorally in CI (strict), and the runtime ingests
  with a lenient grammar guard — a violation becomes a droppable diagnostic
  plus a visible warning, never a hard failure (#1320: one bad event must
  never block a host).
- Implement the generic `BridgeProviderAdapter` in `agent-runtime`, driven by
  declaration data. Add the turn-start watchdog.
- Existing integration tests (`integration.provider-basic`, `multi-provider`,
  `resume`, `env-isolation`, `workspace-cwd`, `interactive-requests`,
  `skill-roots`) are the behavior pin and must stay green throughout.

### Phase 2 — Make each provider protocol-pure (one PR per provider)

Move translation/schemas/visibility/model code from each in-core adapter
into that provider's bridge; the provider runs on the generic adapter
**behind a per-provider experiment flag** (read at provider-process spawn —
existing sessions are never handed between paths). During the window the old
adapter and the new bridge import the *same* translation modules — the code
moves once, only thin glue differs — so "keeping the old path" costs no
duplicated 5k-line translators and no double maintenance. Graduation (see
Rollout below) deletes the bespoke adapter and the flag. Adapter unit tests
move with the code and become bridge tests; every bridge passes the
conformance kit in its own package.

Order by distance from the target shape — which is also **ascending
stakes**: codex and claude-code are the flagship providers (the deepest
adapters, the richest capabilities, and the bulk of real usage), so they
migrate last, on machinery already proven twice against providers where a
regression costs little. acp and pi are the practice rounds; they harden
the kit, the generic adapter, and the parity-replay harness before either
flagship is touched. Start recording codex/claude traffic corpora for the
parity replay during phase 1, so the flagship migrations begin with the
richest evidence base rather than assembling it late.

1. **acp** — `bridge-protocol.ts` is nearly the protocol already.
2. **pi** — bridge exists; adapter translation is the thinnest.
3. **claude-code** — bridge exists; `translate-message.ts`,
   `task-translation.ts`, `interactive-contract.ts`, model list move into it.
4. **codex** — new bridge wrapping `codex app-server` (the current adapter's
   `event-translation.ts` + `schemas.ts` move largely verbatim). Codex's
   thread-scoped process behavior and archived-session error handling become
   declared data / protocol errors, deleting the codex-specific code in
   `runtime.ts`.

No server↔daemon wire change in this phase; bridges stay daemon-bundled.

### Phase 3 — Declarations become the plugin surface

- Add `bb.agents.experimental_registerProvider` to the plugin SDK
  (contract + fake-host + `host-policy.ts` validation + `api_to_audit.md`).
- Add `ProviderRegistryService` in the server; point all catalog consumers at
  it. During this phase the static catalog feeds the registry as core-owned
  declarations, so the resolved provider set is provably identical
  (snapshot-equality test on `GET /system/providers` before/after).
- `ProviderInfo` gains `kind`; built-ins populate the existing `logoUrl`;
  delete all three hardcoded icon maps (app, tasks plugin, automations
  plugin); fix the six call sites that ignore `logoUrl`; remove
  `@bb/agent-providers` from the app bundle.

### Phase 4 — Built-ins ship as first-party plugins

- New builtin plugins (auto-installed, enabled by default):
  `provider-codex`, `provider-claude-code`, `provider-pi`, and
  `provider-acp` (owns the cursor profile, the known-agents list, and the
  `customAcpAgents` config — which keeps working unchanged, and finally gets
  a settings UI for free).
- Bridge source moves into each plugin; the daemon build pulls their bundles
  so `source: bundled` still holds (no wire change yet).
- Graceful absence: an unregistered provider disappears from pickers;
  existing threads of a missing provider render a "provider unavailable"
  state instead of erroring. This is tested by disabling a provider plugin.
- Delete the `@bb/agent-providers` catalog (shared types move to
  `@bb/domain` / the plugin SDK contract).

### Phase 5 — Bridge artifact delivery (unlocks third-party providers)

- `bb plugin build` emits `dist/provider-bridge.mjs`; server stores it
  content-addressed; daemon gains fetch/cache/verify by hash; session
  payloads carry the generalized launch spec. **One
  `HOST_DAEMON_PROTOCOL_VERSION` bump**, with an old-daemon compat test.
- Flip first-party plugins to artifact delivery to soak the path (keep
  `bundled` as fallback for one release, then remove).
- Ship a sample provider plugin in `examples/plugins/` wrapping the existing
  fake provider script — executable documentation and a conformance target.
- Distribution for third-party provider plugins rides the marketplace
  infrastructure that landed 2026-08-14 (#1579–#1582: collection manifests,
  git/semver sources, the BB Official catalog) — no new distribution
  mechanism is needed.
- Update discoverable surfaces in the same change: `bb-plugin-authoring`
  skill, `docs/cli-guide-and-skill.md` surfaces, guide templates.

### Phase 6 — Consolidation sweep (independent cleanups)

Each deletes a scattered special case in favor of declared capability or
protocol method. One guardrail governs the whole phase: **generalizing must
not degrade the flagships.** codex and claude-code are the best provider
experiences bb has; every registry-driven replacement (usage UI, settings
surfaces, onboarding) must express the full richness their hardcoded
surfaces have today — the point of this plan is to raise other providers to
their level, never to flatten them toward a common denominator.

- `supportsManualCompaction` string list → capability + `thread/compact`
  protocol method.
- `skillProviderSchema` closed enum → open provider id.
- Daemon per-provider CLI tables (`provider-cli-health.ts`,
  `known_acp_agents.status`) → the optional `provider/health` /
  `provider/install` / `provider/update` bridge methods. The existing daemon
  tables keep working untouched through phases 1–5 and are deleted here.
- `PROVIDER_SKILL_SPECS` + `resolveProviderExtraRoots` → the optional
  `skills/scanRoots` bridge method with daemon-side caching. (The injection
  side is not deferred to this phase: the canonical `skills/configure`
  payload is part of the phase-1 protocol, and each bridge's native
  transformation moves in with the rest of its translation in phase 2,
  deleting `buildSkillRoots`, the runtime skill-root filter, and the
  skill-root union then.)
- `providerCliKeyValues` / fixed-key `providerUsageResponseSchema` → generic
  per-provider-id map backed by an optional `provider/usage` bridge method;
  usage-limits and CLI-install UI become registry-driven.
- Host-daemon AI services (voice/inference, codex-only daemon commands) →
  optional protocol capability on the bridge.
- `thread-timeline-active-prompt-mode` enum + `thread-view` provider
  switches → normalized event fields emitted by bridges.
- `EDIT_MESSAGE_PROVIDER_IDS` → capability.
- Onboarding and `SETTINGS_PROVIDER_ENTRIES` → registry-driven.
- Plugin-side provider id lists → capabilities/branding read off
  `ProviderInfo`: the ask-user-question plugin's `NATIVE_TOOL_PROVIDER_IDS`
  duplicates what `supportsNativeUserQuestion` declares (today that
  capability has no production consumer at all — the plugin hardcodes its
  own list instead), and the provider-retry banner's `providerLabel` switch
  (`plugins/provider-retry/banner.tsx`) duplicates registry display names.

## Rollout: experiment toggles and graduation

Risky flips ship behind experiments, per the house pattern: the provider
session-release experiment (`3bc9ce54b`, on main) already plumbs an
experiment flag server → session payload → daemon → runtime, which is
exactly the path the phase-2 flag needs.

Three toggles, at the seams the phases already have — deliberately **not**
one global "plugin providers" switch (providers migrate one at a time, so
mixed old/new states must work regardless; a global switch would couple the
phases and keep the entire old world alive at once):

1. **Per-provider adapter path** (phase 2): bespoke adapter vs generic
   bridge adapter, default old, evaluated when a provider process spawns.
2. **Registry source** (phases 3–4): core catalog vs plugin declarations,
   backed by the registry-equality snapshot test.
3. **Bridge delivery source** (phase 5): `bundled` vs `artifact` per
   provider — already modeled as data in the launch spec.

Phases 1–4 change no wire schemas, so toggles create no daemon-version
matrix; the phase-2 flag rides the session payload like the release
experiment does. Graduation per toggle: conformance kit green, dual-path
parity replay clean, a defined incident-free soak with default-on, then a
**deletion PR** that removes the old path and the flag. Weight the rigor by
stakes: codex and claude-code get the largest replay corpora, the longest
soaks, and the deepest manual QA; pi and acp can graduate faster. The codex
bridge deserves the most caution of all — it is the only *new* bridge and it
serves the top provider. Every toggle is
created with its deletion PR scheduled — "for the time being" is a soak
window, not a steady state.

## Verification

- **Behavior pin**: the `agent-runtime` integration suites and
  `tests/integration` fake-provider smoke tests stay green on every PR; they
  cover start/resume/steer/interactive/env-isolation/multi-provider paths
  that past incidents came from.
- **Conformance kit per bridge**, run in each provider package's own tests
  (package-level QA), so a shared-protocol regression fails in four places
  loudly.
- **Translation fidelity**: adapter test suites move with the code — they are
  not rewritten, so event-translation expectations carry over verbatim.
- **Dual-path parity replay** (unique to the toggle window): recorded
  provider traffic replayed through the old in-core adapter and the new
  bridge must emit identical `ThreadEvent` streams; run per provider before
  flipping its default. This is stronger evidence than the moved tests — it
  compares the two live implementations, not expectations.
- **Registry equality**: snapshot test that the provider set, capabilities,
  and defaults resolved from plugins are byte-identical to the catalog at the
  phase 3→4 boundary.
- **Wire discipline**: contract test asserting `HOST_DAEMON_PROTOCOL_VERSION`
  and session schemas are untouched through phases 1–4; the single phase-5
  bump follows the AGENTS.md rule and triggers enrolled-daemon auto-update.
- **Manual QA per provider** via `scripts/bb-dev-app` at each phase-2 PR and
  at phase 4/5: start, turn, steer, permission prompt (allow + deny), model
  list + reasoning selection, resume after daemon restart, fork (where
  supported), stop (interrupt + release), archive/compaction/usage where
  supported, plugin disable → provider-unavailable state.
- **Rollback**: every phase is forward-only code motion with stable ids;
  worst case is a per-PR revert. Phase 4 can revert to catalog-fed registry
  without touching data; phase 5 keeps `bundled` fallback during soak.

## Explicitly out of scope

- Router delegation semantics: only the `kind` metadata and the
  bridge-optional declaration rule ship; the submit-time resolution hook is
  future work for the auto-router plugin.
- Per-provider timeline rendering via plugin frontends — bridges normalize
  events instead; provider plugins may use existing slots (settings sections,
  composer customizations) for provider-specific UI.
- Fixing the ACP path's protocol-level limitations (the acp plugin becomes
  the co-located home where that work can happen incrementally).
- Sandboxing bridges beyond installation trust.

## Decisions (Michael, 2026-08-14)

1. **Bridge trust**: installation trust is sufficient — no per-host approval
   step. Matches plugins and `customAcpAgents` today.
2. **Disable-ability**: first-party provider plugins are individually
   disable-able; the "provider unavailable" absence path must be correct.
3. **Routers**: two motivating archetypes — a dynamic "Auto" router (a
   user-authored routing prompt resolves each submission) and a preset
   router (a user's few favorite provider/model/reasoning pairs as one
   compact picker list for keyboard switching). Neither is built now; this
   change ships `kind`, the bridge-required-for-agents /
   bridge-absent-for-routers declaration rule, and server-supplied picker
   entries, leaving the resolution hooks as future work. Every regular
   provider registers a host-run bridge implementing the protocol.
4. **`customAcpAgents`** (default stands, not explicitly decided): keep
   config.json compatibility under the acp plugin; add the settings UI on
   top.

## Appendix: Phase 2 anatomy — what the four adapters share and where the code moves

Each provider today is an in-core adapter (the 18-member `ProviderAdapter`)
plus, for three of four, a bridge child process:

| Provider | In-core today | In bridge today | Child process |
| --- | --- | --- | --- |
| claude-code | ~5.2k lines (adapter 1357, `translate-message.ts` 1073, `task-translation.ts`, `schemas.ts`, `interactive-contract.ts`, visibility 620, model list, error-info, sdk-extraction) | ~4.2k (`bridge.ts` 2109 wrapping the Claude Agent SDK, readonly-bash policy, session options, mock-CLI proxy, MCP tool proxy) | `node bb-claude-code-bridge.mjs` |
| pi | ~2.1k (adapter 1547, visibility, model list) | ~2.4k (wraps the Pi SDK) | `node bb-pi-bridge.mjs` |
| acp | ~2.5k (adapter 1552, `wire.ts`, `bridge-protocol.ts`, visibility, profiles) | ~3.2k (generic ACP client, permission/fs policy, model catalog, MCP tool proxy) | `node bb-acp-bridge.mjs` → ACP agent |
| codex | **all in-core**: ~5.3k hand-written (adapter 2239, `event-translation.ts` 1095, `schemas.ts` 998, interactive requests, permission maps, visibility, models) + ~1.9k generated app-server schema types | none | `codex app-server` directly |

**A shared core, with real divergences.** Six methods plus `initialize`
are identical on every process boundary — all four send `model/list`,
`thread/start`, `thread/resume`, `turn/start`, `turn/steer`, and a stop
verb. The bb-authored bridges use bb-shaped methods, and codex app-server's
native protocol is what `AdapterCommand` was modeled on. But uniformity ends
there — the command→method mapping itself diverges, and phase 1 must pick a
canonical mapping for each divergence:

- acp gained `thread/fork` only on 2026-08-14 (`53d193144`), gated on the
  agent advertising the unstable ACP fork capability at initialize, and
  tip-only (checkpoint forks rejected — ACP clones whole sessions); before
  that the command threw before reaching the wire.
- codex maps `thread/stop` → `turn/interrupt`, `thread/discard` →
  `thread/archive`, and compaction → `thread/compact/start`; claude maps
  `thread/discard` → `thread/stop`; acp noops discard.
- claude sends no compaction method; acp's `thread/compact` is gated to
  `acp-opencode` only.
- `skills/configure` becomes a wire request only on codex
  (`skills/extraRoots/set`); the three bb bridges noop it and carry skill
  roots in session-construction params instead.
- codex speaks methods no bb bridge has: `thread/name/set`,
  `thread/archive`/`unarchive`, `thread/goal/clear`,
  `account/rateLimits/read`.

These mappings live in each adapter's `buildCommandPlan` today and move into
that provider's bridge in phase 2 — still code motion, but the codex bridge
is a method-mapping layer, not a passthrough. `createStandardAdapterMembers`
(`shared/standard-adapter-members.ts`) is already the de-facto base class —
it synthesizes command dispatch, unsupported-command noops, accepted-user-
message events, tool-call decode, and normalized model-list parsing. The
generic `BridgeProviderAdapter` is essentially that helper with its
per-provider slots — chiefly `buildProviderCommandPlan` and `translateEvent`
— turned into constants or declaration data.

**Genuinely different — the four deltas:**

1. **Inbound event vocabulary** (~70% of adapter code). claude-code and pi
   bridges forward raw SDK payloads in `sdk/message` envelopes; acp forwards
   semi-normalized `acp/update` notifications; codex emits app-server
   notifications (`turn/started`, `item/*`, deltas). Each `translateEvent`
   converts its language into the same bb `ThreadEvent`s. Pure translation,
   no runtime-state dependencies → moves file-for-file into each bridge,
   which then emits `thread/event` notifications carrying finished
   `ThreadEvent`s. Unit tests move verbatim.
2. **Codec split (`native` vs `normalized`) = turn-id ownership.** Codex
   turn ids come from the provider (hence `prepareTurnStart` correlation,
   custom model-list parsing, tool calls keyed by `threadId`); the other
   three synthesize bb turn ids in adapter-held state (tool calls keyed by
   `providerThreadId`). The distinction **dissolves** rather than porting:
   with translation and id synthesis both inside the bridge, every bridge
   mints turn/item ids under the same conformance rules (turn-scoped,
   per-instance entropy), the codex bridge keeps its id mapping internal,
   and the two-shape `item/tool/call` contract collapses to one.
3. **Interactive/permission requests.** claude-code: richest contract +
   the only `approvalRequestPolicy: "provider"` adapter (bridge pre-filters
   against policy). codex: approval-decision maps. acp: single
   `acp/permission/request`. pi: none (`full`-only). The canonical
   `PendingInteractionPayload` union already exists in `@bb/domain`
   (`packages/domain/src/pending-interactions.ts`); bridges emit those
   shapes, the mapping moves inside, and `approvalRequestPolicy` stays declared (the
   runtime already supports both modes).
4. **Execution-settings behavior.** claude is the sole outlier:
   `classifyClaudeExecutionSettingsChange` supports live model/reasoning
   swap, while codex, pi, and acp all share
   `classifySessionExecutionSettingsChange` (any change → rebuild), and
   `normalizeExecutionOptions` is implemented by claude alone. Both members
   delete rather than port: the runtime stops diffing options entirely and forwards them on
   every command; the bridge reconciles internally (apply live, or rebuild
   its provider session — including restarting its own child process) and
   must report rebuilds explicitly. Nothing declared replaces them: #1610
   removed the last consumer of a live-vs-session table, and rebuild
   visibility is event-sourced (the mandatory session-replacement
   notification; ACP already warns on lossy resume today).

Plus the out-of-adapter leakage that gets deleted: codex process keying,
archived-session regexes, rename-retry, and account-restart tracking in
`runtime.ts` become declared
`processScope` + typed protocol error codes; per-provider `visibility.ts`
becomes the bridge's own choice of what to forward on the droppable
`provider/raw` channel.

**Per-provider PR mechanics** (same three moves each): fix the bridge's
params/notifications to the canonical schemas → relocate translation modules
into the bridge and emit `ThreadEvent`s → delete the bespoke adapter and
register on the generic adapter with declaration data. Ordering by gap size:
acp (bridge-protocol.ts is ~90% the target), pi (smallest translation move),
claude-code (largest translation + exercises the `"provider"` approval path),
codex (the only *new* bridge — it inherits the translation code verbatim,
but on the command side it is a method-mapping layer, not a passthrough: six
of its command→method mappings diverge from the bb bridges, see above; costs
one extra process hop, buys uniform lifecycle, the env allowlist, and
deleting the `runtime.ts` special cases). Only phase 1 involves design;
phase 2 is code motion pinned by tests, plus one canonical-mapping decision
per divergent command.
