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
   runtime, **and the app bundle** (`apps/app/src/hooks/queries/system-queries.ts`,
   `apps/app/src/lib/provider-icon.ts`).
2. **Adapter** — `packages/agent-runtime/src/{codex,claude-code,pi,acp}/`:
   the 16-member in-process `ProviderAdapter`
   (`packages/agent-runtime/src/provider-adapter.ts`), 4.4k–9.4k lines per
   provider. Three of four already spawn a bb-authored **bridge** Node bundle
   over line-delimited JSON-RPC (`shared/bridge-harness.ts`); codex speaks its
   native app-server protocol in-process. Event translation, schemas,
   visibility, and model parsing live **in core**, per provider.
3. **Registry wiring** — `packages/agent-runtime/src/provider-registry.ts`.
4. **Daemon host-local tables** — `apps/host-daemon/src/provider-cli-health.ts`
   (executables, install/update commands), `injected-skills.ts` (skill-root
   layout), `command-handlers/list-commands.ts::PROVIDER_SKILL_SPECS`
   (largest per-provider table, 8 ids).
5. **UI metadata** — hardcoded icon/color maps in
   `apps/app/src/lib/provider-icon.ts` and a duplicate in
   `plugins/tasks/views/activity/provider-logo.tsx`; `logoUrl` honored at only
   one of ~6 icon call sites.
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
(`hostDaemonAcpLaunchSpecSchema`) resolved per command from config, run by the
generic ACP bridge. It works, but the path is deliberately least-common-
denominator: no fork, no `auto` permission mode (ACP threads default to
`full`), no token usage, no native slash commands/modes, degraded
approvals/models/reasoning, config.json-only setup, no settings UI.

**Plugins** run in-process in the server only. The host daemon has **zero**
plugin extension points; a plugin reaches a host only through `bb.sdk` routes
or the shared-port control plane. Plugin registration surfaces, artifact
management (`managed-plugin-artifacts.ts`), builtin auto-install
(`builtin-registry.ts`), asset serving, and the `experimental_` +
`docs/api_to_audit.md` convention all exist and are reusable here.

**Wire facts**: DB and domain already store `providerId` as a free string (the
closed enum lives only in the catalog); `HOST_DAEMON_PROTOCOL_VERSION` is 121
and has been bumped by **92 commits since 2026-06** — provider behavior is
tightly coupled to daemon deploys, which this plan explicitly decouples.

## Lessons from past incidents → design requirements

From the incident archive (issues/PRs/commits touching providers). Each lesson
becomes a concrete property of the new design; the conformance kit (below)
encodes the testable ones.

| Lesson (incident) | Design requirement |
| --- | --- |
| 92 protocol bumps; translation fixes require daemon deploys | Bridges version independently of the daemon. `initialize` negotiates `{protocolVersion, capabilities}` both ways; unknown methods/fields degrade, never crash. |
| Idle reaping was Codex-only by accident (#1604); process-key scheme encoded eligibility | Declaration carries explicit `processScope: "thread" \| "shared"` and `sessionPersistence: "none" \| "resume"`; reap eligibility derives from declared data, not string prefixes. |
| Release vs interrupt conflated (#1584) | Protocol `thread/stop` carries `intent: "interrupt" \| "release"` from day one. |
| Turn settlement gaps — six separate fixes, no watchdog (#1431, #1234, #1156) | Runtime (single owner of the turn state machine) keeps the accepted→dispatched→started→completed states; add the missing **turn-start watchdog** (visible failure if no `turn/started` within a bound). |
| Session replaced as silent side effect of config diff (#1268, #1236) | Execution-option scope (`live` vs `session`) is **declared data** per option per provider, not adapter code; session replacement is an explicit, logged decision. |
| Provider-minted ids trusted as bb ids froze a host for 30 min (#1320) | Protocol schema forbids the bridge from minting bb turn ids; only caller-vouched ids scope events. Diagnostic events are droppable by construction. |
| Silently dropped undecodable JSON-RPC → 30s timeouts (#853) | Conformance rule: undecodable → `-32602` reply with issues; unknown method → `-32601`; request/response discriminated on `method`. |
| Per-session item-id counters collided across resumes → permanent 500 (#1224) | Conformance rule: item ids unique across resume (turn-scoped with per-instance entropy); projection degrades, never throws. |
| Schema drift: `null`-for-absent, new enum members broke whole listings (#1044, #580, #1148) | Protocol schemas are lenient at the edge (soft-parse unknown enum members, null-tolerant); one malformed entry degrades to one missing entry. |
| Ambient env leaks (`BB_THREAD_STORAGE`, Volta, Electron) (#1366, #1545) | Bridge env is **constructed by one allowlist function**; the daemon's own env is not reachable from provider-facing code. |
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
  `thread/archive`, `thread/unarchive`, `skills/configure`.
- **Bridge → runtime notifications**: normalized bb `ThreadEvent` envelopes
  (the "normalized codec" in `shared/standard-adapter-members.ts` +
  `shared/json-rpc-envelope.ts` is the starting point: `thread/event`,
  `thread/identity`, `thread/contextWindowUsage`, `thread/tokenUsage`,
  `error`), plus a droppable `provider/raw` diagnostic channel that replaces
  in-core visibility classification.
- **Bridge → runtime requests**: `item/tool/call` (dynamic plugin tools),
  interactive/permission requests using the canonical
  `PendingInteractionPayload` shapes (`shared/pending-interaction-normalization.ts`).
- **Handshake**: `initialize` exchanges `{protocolVersion, capabilities}` in
  both directions. Optional capabilities cover the long tail: usage reporting,
  compaction, host AI services (voice transcription / structured inference —
  today's codex-only daemon commands), fork, archive.

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
- skill-root filtering, event queueing to the server

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
| `classifyExecutionSettingsChange` | declared per-option scope table (`live` / `session`) in the declaration |
| `normalizeExecutionOptions` | audit the four impls: fold data-shaped cases into declared option metadata; anything genuinely code-shaped moves into the bridge's own command handling |
| `buildPostInitializeRequests`, `prepareTurnStart`, `clearActiveTurnState` | deleted — bridge-internal or generic turn-state concerns |
| `buildThreadDetachedEvents` | generic: runtime reconciles from its own background-work state |
| per-provider `visibility.ts` | deleted — bridge classifies before emitting `provider/raw` |

`ProviderExecutionContext` loses `claudeCodePermissionMode` /
`claudeCodeMockCliTraffic`: plan-mode becomes a declared prompt-mode
capability + a normalized field; mock CLI traffic becomes a
bridge-test-harness concern inside the claude plugin.

### 3. The declaration (plugin surface)

New `BbPluginApi` member, per the stability convention shipped as
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
  kind: "agent",                        // "agent" | "router" — metadata only for now
  capabilities: {
    // one merged block: today's ProviderCapabilities + ProviderServerCapabilities
    fork: true, archive: false, rename: false, serviceTier: false,
    userQuestion: true, workflows: true, executionOverride: true,
    manualCompaction: true, messageEditing: true,
    permissionModes: ["accept-edits", "auto", "full"],
    reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    promptModes: ["plan"],
    sessionPersistence: "resume",       // reap/resume eligibility, declared
    processScope: "shared",             // "thread" (codex) | "shared"
  },
  composerActions: [...],
  executionOptionScopes: { model: "live", reasoningLevel: "live", ... },
  approvalRequestPolicy: "provider",
  bridge: { entry: "provider-bridge" }, // built artifact, see delivery below
  cli: {                                // drives generic daemon health/install
    executable: "claude", npmPackage: "@anthropic-ai/claude-code",
    minVersion: "...", install: {...}, update: {...},
  },
  skillRoots: {...},                    // replaces PROVIDER_SKILL_SPECS rows
});
```

Server side, a new `ProviderRegistryService` becomes the single source of
provider metadata. Every current consumer of `@bb/agent-providers`
(execution options, thread default policy, reasoning policy, permission
ceiling, fork/compaction gates, typeahead, onboarding) reads from it.
`ProviderInfo` gains `kind` and a real `logoUrl`; the app deletes both
hardcoded icon maps and reads `logoUrl` at every icon call site. The app
stops importing `@bb/agent-providers` entirely (the speculative
execution-options placeholder switches to last-known server data).

`kind: "router"` is **reserved metadata** in this change: declared, stored,
surfaced on `ProviderInfo`, but nothing in core implements delegation. A
router provider's bridge does its own delegation behind the same protocol.

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
  normalized codec, `acp/bridge-protocol.ts`, and the envelope/tool-call/
  interaction shapes in `agent-runtime/src/shared/`.
- Build the **conformance kit**: a black-box test suite that drives any
  bridge binary through the full lifecycle (initialize handshake, start,
  turn, steer, permission request, resume, fork-or-declared-absence, stop
  with both intents, malformed-message replies, item-id uniqueness across
  resume, env allowlist). It encodes the incident-derived rules above.
- Implement the generic `BridgeProviderAdapter` in `agent-runtime`, driven by
  declaration data. Add the turn-start watchdog.
- Existing integration tests (`integration.provider-basic`, `multi-provider`,
  `resume`, `env-isolation`, `workspace-cwd`, `interactive-requests`,
  `skill-roots`) are the behavior pin and must stay green throughout.

### Phase 2 — Make each provider protocol-pure (one PR per provider)

Move translation/schemas/visibility/model code from each in-core adapter into
that provider's bridge; delete the bespoke adapter; the provider now runs on
the generic adapter. Adapter unit tests move with the code and become bridge
tests; every bridge passes the conformance kit in its own package.

Order by distance from the target shape:

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
- `ProviderInfo` gains `kind` + populated `logoUrl`; delete both hardcoded
  icon maps; fix the ~5 call sites that ignore `logoUrl`; remove
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
- Update discoverable surfaces in the same change: `bb-plugin-authoring`
  skill, `docs/cli-guide-and-skill.md` surfaces, guide templates.

### Phase 6 — Consolidation sweep (independent cleanups)

Each deletes a scattered special case in favor of declared capability or
protocol method:

- `supportsManualCompaction` string list → capability + `thread/compact`
  protocol method.
- `skillProviderSchema` closed enum → open provider id.
- `providerCliKeyValues` / fixed-key `providerUsageResponseSchema` → generic
  per-provider-id map backed by an optional `provider/usage` bridge method;
  usage-limits UI becomes registry-driven.
- Host-daemon AI services (voice/inference, codex-only daemon commands) →
  optional protocol capability on the bridge.
- `thread-timeline-active-prompt-mode` enum + `thread-view` provider
  switches → normalized event fields emitted by bridges.
- `EDIT_MESSAGE_PROVIDER_IDS` → capability.
- Onboarding and `SETTINGS_PROVIDER_ENTRIES` → registry-driven.

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

- Router delegation semantics (only the `kind` metadata ships).
- Per-provider timeline rendering via plugin frontends — bridges normalize
  events instead; provider plugins may use existing slots (settings sections,
  composer customizations) for provider-specific UI.
- Fixing the ACP path's protocol-level limitations (the acp plugin becomes
  the co-located home where that work can happen incrementally).
- Sandboxing bridges beyond installation trust.

## Open questions (recommended defaults in parentheses)

1. Third-party bridge trust: is installation trust sufficient, or do we want
   a per-host approval step before a plugin's bridge first runs on an
   enrolled machine? (Default: installation trust, matching plugins and
   `customAcpAgents` today.)
2. Are first-party provider plugins individually disable-able? (Default:
   yes — it forces the graceful-absence path to be correct, which a crashed
   plugin exercises anyway.)
3. `kind: "router"` — reserved metadata only, or does something read it in
   this change? (Default: reserved.)
4. `customAcpAgents` long-term: keep config.json compatibility under the acp
   plugin indefinitely, or migrate to plugin settings with a one-time import?
   (Default: keep compatibility; add the settings UI on top.)
