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

## Implementation status (2026-08-14, end of day)

Landed on this branch, every commit green:

- **Phase 1 complete**: `@bb/provider-bridge-protocol` (schemas, versioned
  capability handshake, `docs/provider-bridge-protocol.md` with the event
  grammar), the conformance kit (`@bb/provider-bridge-protocol/conformance`),
  the generic `BridgeProviderAdapter`, and the turn-start watchdog
  (`provider_turn_start_timeout` system/error; no wire change).
- **Phase 2a and 2b complete**: the acp and pi bridges are protocol-pure —
  11/11 conformance each, per-session dialects, shared (not duplicated)
  translators, honest stop intents, reply-never-drop hygiene (which fixed a
  real latent bug: #859 never implemented #853's replies in the acp bridge;
  same finding in pi). The `providerBridge` experiment (initially four
  per-provider keys, later collapsed into one toggle) is wired end to
  end via a new additive `/provider-bridge-policy` endpoint — zero wire
  schema changes, no protocol bump. Pi capabilities verified with evidence:
  sessionRestore true, fork "checkpoint".
- **Phase 3 complete (server-side)**: `ProviderRegistryService`
  (catalog-equality pinned), `bb.agents.experimental_registerProvider`
  (contract + host-policy + fake host + api_to_audit entry), and the full
  policy-consumer repoint — plugin-registered providers appear in listings
  and are accepted by thread policy end to end. UI decoupling (icon maps,
  app catalog imports) intentionally trails until phase-4 icon assets exist.
- **Phase 2 complete**: all four providers are conformant bridges (11/11
  each). claude (c85cca643): translation extracted byte-identically,
  session/replaced wired at both rebuild sites, canonical interactions for
  approval + AskUserQuestion + plan-mode exit; findings: manual compaction
  is prompt-text on claude (handshake false), fork is checkpoint-capable
  via forkSession (evidence for the fork/rewind merge candidate). codex
  (7bf1844e0): the one new bridge, canonical-only, owning per-thread
  app-server children with the #1402 supervision rules; structural
  bridge-minted ids reverse-map legacy-persisted codex ids;
  archived-session resumes reply SESSION_NOT_RESTORABLE. One `providerBridge`
  experiment toggle (default off) routes all four providers onto the
  canonical protocol. The turn-start watchdog shipped (system/error, no
  wire change).
- **Phase 4 complete**: the four first-party provider plugins are builtin
  and enabled by default, taking over their core-seed entries in place
  (position-preserving, restored on disable; the takeover merge preserves
  handshake-owned facts so flagship behavior cannot regress). The listing
  differs from the seed only in logoUrl and source, pinned by test. The
  app no longer depends on @bb/agent-providers: icons resolve
  logoUrl-first over the vendored interim fallback, fork gating reads
  server ProviderInfo, and the cold-cache placeholder is inlined.
- **Phase 5 complete**: bb.providerBridge plugins build self-contained
  bridge artifacts, the server stores and serves them content-addressed,
  the daemon caches by verified hash, and an optional strict bridgeLaunch
  rides beside acpLaunchSpec — HOST_DAEMON_PROTOCOL_VERSION 123 → 124
  after the rebase onto main (which took 123 for artifact engine ranges),
  the plan's one bump, with prior-version compat fixtures. First-party providers
  stay bundled (wire-identical payloads) until graduation.
  examples/plugins/echo-provider proves the third-party path end to end,
  passing the same 11-scenario conformance gate as the first-party four.
- **Live QA (real CLIs against a dev server)**: full matrix passed for
  codex / claude-code / pi / acp-opencode — canonical process trees, two
  turns each, steer/stop/resume, models lists, flag-off legacy regression.
  Two real bugs found and fixed with regression tests: the codex bridge's
  construction signature included envVars the runtime never sends on
  turns (every first turn rebuilt the session and died on the missing
  rollout), and a failed session construction leaked the thread-scoped
  bridge process. Known open design item for phase 6: bridge adapters
  classify every settings change as "live", but the runtime never carries
  envVars on turn options, so an env-var change cannot rebuild a live
  bridge session (legacy classified it as a session change).
- **ALL FOUR PROVIDERS ARE GRADUATED (2026-08-15)**: every legacy adapter
  and its suite are deleted (acp, pi, then claude-code and codex), plus the
  pi and codex dual-path calibrations' legacy legs. With no legacy path
  left, `createBridgeProtocolAdapterForId` lost its prefix gate and
  `createProviderForId` lost the built-in factory table: every provider
  routes to the generic bridge-protocol adapter unconditionally.
  `bridgeProtocolProviderPrefixes` is now accepted-and-ignored; retiring the
  field is wave 3, since it is plumbed through the daemon.
  `shared/standard-adapter-members.ts` (254 lines) assembled legacy adapters
  only and went with them, as did `codexSkillRootPath` (the canonical path
  normalizes skill roots before they reach codex, so its guard was
  unreachable).
  Shared-module invariants pinned only by the deleted suites moved first,
  re-expressed against the modules rather than command plans:
  acp/session-params.test.ts, acp/event-translation.test.ts,
  pi/{event-translation,session-params,model-list}.test.ts,
  claude-code/{event-translation, event-translation.tool-calls,
  event-translation.usage, interactions}.test.ts, and codex/
  {event-translation,interactive-requests,session-params}.test.ts plus 24
  cases into codex/translator.test.ts for the three stateful families that
  suite uniquely held (git writable-root staging/activation/clearing,
  raw-shell command-output recovery, native-subagent correlation).
  `isStandaloneBuiltinCompactCommand` moved to @bb/domain.
  The pi/claude-code/codex calibrations are now bridge-only scripted-session
  goldens — with one path left there is nothing to calibrate, but the
  whole-session shape is worth pinning.
  Two latent bugs surfaced and are fixed, both the same shape — a knob only
  the legacy path configured:
  1. (wave 1) the bundled acp-cursor provider had no launch spec on the
     canonical path; its launch data now lives in acp/launch-specs.ts and
     the registry falls back to it.
  2. (wave 2) the model-derived context-window hint was seeded only as a
     side effect of building a legacy command plan — nothing under
     claude-code/bridge/ ever called `setClaudeModelContextWindowHint`, so a
     result omitting `modelUsage.contextWindow` produced NO context-window
     event at all (capacity unknown, notably for the 1M `[1m]` aliases). The
     bridge now seeds it at session construction and on every live model
     change, pinned by a bridge test that fails without it.
     `hasOpenThreadWork` had no canonical implementation, so a codex session
     whose only live work is a native subagent looked idle to the runtime's
     reaper. FIXED in wave 4 by the `thread/openWork` notification (below).
- **WAVE 3 DONE (2026-08-15)**: the `providerBridge` experiment, its
  settings toggle, and the whole `/internal/provider-bridge-policy`
  endpoint are deleted — the response carried only the prefix list, and
  plugin routing always rode the per-command `bridgeLaunch`, so nothing
  survived the endpoint. With it went the daemon's policy cache/startup
  backoff/reaper piggyback, the runtime-manager capture, the
  accepted-and-ignored `bridgeProtocolProviderPrefixes` option, and a
  second dead field, `ProviderAdapterFactoryOptions.turnIdPrefix` (minted
  per adapter, read by none; the translation-layer `turnIdPrefix` is a
  different, live option). v124 is unshipped, so no further protocol bump;
  the v123-compat fixtures never referenced the route.
  The server's **core catalog seed is deleted**: plugin declarations are
  the sole source, so disabling a provider plugin now removes its provider
  instead of degrading it to a core entry, and the takeover /
  restore-on-dispose machinery is gone. The blocker was the takeover's
  transitional merge, which preserved facts the declaration could not
  express; three of them (`supportsThreadArchive`, `supportsThreadRename`,
  `supportsWorkflows`) became declared capabilities, and the fourth
  (`supportsSessionRestore`) turned out to have no server consumer at all
  and was dropped from the server-side shape. Listing order became
  explicit (`PRODUCT_PROVIDER_ORDER`) because it would otherwise fall out
  of plugin load order — alphabetical by plugin id, and re-ordered by a
  disable/re-enable; `PRODUCT_DEFAULT_PROVIDER_ID` is now its head rather
  than a second hardcoded id. An install with every provider plugin
  disabled is reachable now, so it answers 409 `no_provider_available`.
  **@bb/agent-providers is deleted.** The dynamic ACP tier became a server
  module (`services/providers/acp-provider-tier.ts`); the daemon got
  `provider-catalog.ts` for the bundled bridges' pre-handshake capability
  baselines (the role `acp/launch-specs.ts` plays for launch data), plus
  the Claude Code model catalog and the pi default-model map beside their
  consumers. Two consumers took a documented duplicate over a worse
  coupling: the server's probe-failure Claude Code fallback rows (the app
  already keeps its own copy; all three converge in wave 5) and
  @bb/config's bundled-id list (config parses before plugins load).
  **The runtime codex special cases were audited and KEPT.** The bridge
  adapter still reports `providerId === "codex"` and the codex bridge
  reuses the same translator, so the account-restart set, the
  archived-session regex, the empty-rollout rename retry, and the archive
  idempotency strings are all still fed — the bridge preserves those error
  texts verbatim _on purpose_, with comments saying so. Thread-scoped
  process keys are redundant for isolation (the bridge supervises one
  app-server child per thread) but load-bearing for the restart and the
  pre-experiment reap, so collapsing them is a later refactor. Only one
  line was actually stale: the comment claiming codex speaks direct
  notifications while others wrap them.
- **Remaining (phase 6)**: the consolidation
  sweep (scattered enums, usage surfaces, provider-scoped options for
  workflows/memory toggles) — see the phase-6 checklist for what wave 4
  landed and what it deferred;
  interim icon fallbacks and inlined placeholders move server-side;
  collapsing the codex thread-scoped process keys onto
  `thread/stop {release}` + resume.
  The former KNOWN GAP is FIXED: the codex bridge now settles a prompt
  the provider accepts without emitting turn/started, so
  turn/settles-without-activity passes and codex/bridge/
  bridge.conformance.test.ts is all-green again. Settlement is owned by
  the queued turn-start correlation — `PreparedProviderCommandDispatch`
  gained `claim()` (the dispatch-ownership seam), and a turn/started that
  lands after the turn/start response claims the dispatch first, so the
  real turn always wins and no turn is fabricated from a late signal (the
  acp bug 0c2f4cc9a). The graduation prerequisite from the historical-bug
  audit — move every shared translator invariant pinned only by a legacy
  adapter suite into a bridge-path suite before deleting it — is DONE for
  all four providers, as is the calibration gate.

## Graduation execution (started 2026-08-15)

Waves, each ending with a full board (typecheck + all suites) before the
next starts; commits structured so a later PR split stays mechanical:

1. DONE — codex zero-work-prompt settlement fix (the pinned gap) + acp/pi
   legacy adapter deletions (scan adapter tests for uncovered
   shared-module invariants and MOVE them before deleting).
2. DONE — claude-code, then codex legacy deletions (same discipline). No
   legacy adapter remains anywhere.
3. DONE — flag retirement (providerBridge experiment, the whole
   provider-bridge-policy endpoint, daemon prefix capture — no protocol
   bump needed, v124 unshipped), core-seed deletion, @bb/agent-providers
   removal, runtime codex special-case audit (kept, one stale comment).
4. PARTLY DONE (2026-08-15) — phase-6 consolidation sweep. Landed, one
   commit per item, each with its own red-verify: ACP manual compaction as
   a per-agent declaration; the skill provider id opened and the six
   per-provider skill scopes collapsed to `provider-user`/`provider-project`;
   ask-user-question reading `supportsNativeUserQuestion` off the
   configuration context; edit-message eligibility reading the already-
   declared `supportsNativeSessionRewind`; plan mode gating on the declared
   `plan` composer action (widening the prompt-mode enum) plus deleting the
   thread-view display-name switch; and the `thread/openWork` notification
   that finally gives `hasOpenThreadWork` a canonical implementation and
   stops the reaper killing codex native subagents.
   Deferred with reasons on each checklist entry above, in two groups:
   (a) the three sessionless daemon→bridge reads — `skills/scanRoots`,
   `provider/health|install|update`, `provider/usage` — which share one
   transport and should land as their own wave; and (b) the four surfaces
   blocked on new plugin API rather than on consolidation — provider-scoped
   settings toggles, onboarding/settings entries, the provider-retry banner
   label, and provider icon colors. Both groups want a plugin-facing
   provider directory, which does not exist on either SDK surface today.
5. First-party artifact migration: move the four bridge sources into
   their plugin directories and ship them through the content-addressed
   artifact pipeline (echo-provider is the template). After this, every
   provider-specific line lives in plugins/provider-*; agent-runtime
   keeps only the protocol, generic adapter, and supervision.
   **DONE (2026-08-15): codex, claude-code, and acp all ship as plugin
   artifacts. Pi stays daemon-bundled as an empirically verified exception,
   so it is the only bundled bridge left — see the per-provider notes
   below. What remains is the FINAL VALIDATION GATE.**
   Two commits. First, the **bridge kit**: a plugin-shipped bridge cannot
   import `@bb/agent-runtime`, and it turned out nearly every module under
   `agent-runtime/src/shared/` had only provider-side consumers, so they
   moved wholesale (with their tests) to
   `@bb/provider-bridge-protocol/bridge-kit` — JSON-RPC plumbing, the stdio
   harness, tool-call/interaction codecs, id scoping, visibility metadata,
   translation helpers, plus the runtime↔bridge structural types
   `provider-adapter.ts` used to declare. Bridge test infrastructure
   (the in-process JSON-RPC driver, the calibration normalizer) became
   `@bb/provider-bridge-protocol/testing`. `bridge-path`, `available-models`,
   and `permission-policy` stayed behind as runtime concerns. The barrel
   surfaced a genuine collision: two different `jsonRpcEnvelopeSchema` (the
   normalized-codec one and the bridges' inbound-request one, now
   `bridgeRequestEnvelopeSchema`).
   Second, **codex**: sources moved verbatim into `plugins/provider-codex/src`,
   `bb.providerBridge` added, `dist/provider-bridge.mjs` is 868 KB and
   fully self-contained, and its 161 tests run as
   `bb-plugin-provider-codex#test` (CI's packages shard already covers every
   plugin). Every codex carve-out is gone end to end: the daemon bundle
   target, the bb-app `files` entry, the launcher presence assertion, the
   registry branch, and the provider-catalog capability/session-restore
   baselines. The tarball smoke now drives the packed *plugin artifact\* and
   expects `provider-codex` to reach "running" in the packed install.
   Two facts the bundled branch supplied had to become properties of the
   generic route or codex would have silently lost them: (a) environment
   extra workspace write roots are host-local, so no server-sent
   `providerOptions` can carry them — the registry merges them into every
   plugin bridge's static option bag; (b) `bridgeLaunch.capabilities`
   carried only service tier + permission modes, so archive/rename/fork
   would have read false — the wire now carries the three the runtime
   actually enforces, filled from the declaration (v124 unshipped, so no
   bump, but contract/server/daemon/runtime moved together). Session
   restorability needed no wire slot: the bridge already reports it per
   session on `thread/start`, and the catalog table was only a pre-first-
   result seed.
   Blockers found for the remaining three, each different:
   - **pi — hard blocker, EMPIRICALLY VERIFIED (the identity argument was
     wrong).** A fully-inlined single-file artifact was built (14.8 MB,
     faster startup than the 800 KB external control) and driven through
     the real smoke fixtures plus this machine's live pi config. It fails
     for three reasons, none of them module identity (a deliberately
     identity-divergent run passed every suite): (1) pi-coding-agent's
     extension loader aliases the package to path.resolve(<loader
     __dirname>, "../..", "index.js") with no fallback, so any extension
     value-importing pi-coding-agent (all four real installed extensions
     do) cannot load from a relocated bundle — unfixable from bb's side;
     (2) import.meta.resolve for pi-agent-core/pi-tui/pi-ai/typebox runs
     from the artifact path, which has no node_modules ancestor in the
     daemon cache; (3) pi-ai's OAuth flow loader is deliberately
     bundler-hostile (variable specifiers), so inlining breaks
     Anthropic/Codex/Copilot/OpenRouter OAuth even with zero extensions.
     The one artifact shape proven to work end to end is a DIRECTORY —
     bridge .mjs plus a real npm-installed pi tree (~295 MB naive,
     prunable) — the future externals/tree design if pi ever leaves the
     daemon bundle. DECISION: pi's bridge stays daemon-bundled as a
     documented exception. Independently and regardless: DONE — the
     daemon's `createConfiguredPiSettingsManager` import is inlined into
     `list-commands.ts` (the daemon already depends on the Pi SDK) and the
     `@bb/agent-runtime` re-export is gone, so nothing outside the pi
     bridge directory reads from it and pi is not gated on the deferred
     skills/scanRoots method.
   - **acp — DONE (2026-08-15).** The blocker was routing, not bundling.
     `resolveBridgeLaunchForProviderId` now resolves the ACP tier
     explicitly: an unregistered `acp-*` id borrows the artifact of
     whichever plugin declares ACP and takes its capabilities from the
     shared tier — the same fallback every other ACP policy accessor on
     the registry already uses — so known agents and `customAcpAgents`
     entries keep launching. The launch spec rides exactly as before (the
     `acpLaunchSpec` command field, then the provider-scoped statics), and
     `acp-cursor`, whose spec has no server-side entry, still reads the
     runtime's built-in table, now `acp-launch-specs.ts` beside its
     fingerprint. `dist/provider-bridge.mjs` is 919 KB and self-contained;
     no hono reaches it through the `@bb/host-daemon-contract` dependency
     the bridge needs to parse the launch spec (the one core-package
     dependency a first-party bridge still has, and the reason the
     acp-cursor table has not moved server-side yet). 143 tests run as
     `bb-plugin-provider-acp#test`.
     Two test-side consequences worth keeping: the integration harness
     builds and records the first-party bridge artifacts the way the
     plugin runtime does — without a `bridgeLaunch` a graduated provider
     has no bridge at all, so the dynamic-ACP smoke now drives the real
     artifact route; and the host-daemon-contract bridge-launch round-trip,
     left red by the codex commit, is green again.
   - **claude-code — DONE (2026-08-15).** Sources and event fixtures moved
     verbatim; `dist/provider-bridge.mjs` is 2.44 MB, fully self-contained,
     and was driven standalone with an empty PATH (it answers `model/list`
     from the artifact alone). The SDK inlines cleanly, unlike pi: its one
     package-relative resolution is the optional native-CLI package,
     reached only when `pathToClaudeCodeExecutable` is unset, and bb has
     always set that from the host's own `claude` binary precisely because
     the bundled bridge could not rely on package-relative resolution.
     Nothing else in the bridge reads its own module path and its MCP tool
     proxy is in-process.
     The two prerequisites resolved as: the packaged-daemon sentinel moved
     to `bb-pi-bridge.mjs` (pi is the bridge that stays bundled, so it is
     the only file that outlives every other first-party bridge); and
     `shared/permission-policy.ts` moved wholesale into the bridge kit
     rather than being split — it is one three-line predicate, both sides
     import it from the kit, and restating it is exactly how the two sides
     would drift. Every carve-out is gone end to end (bundle target,
     bb-app `files`, launcher assertion, registry branch, catalog
     capability + session-restore baselines) and the tarball smoke drives
     the packed artifact and expects `provider-claude-code` to reach
     "running". 268 tests run as `bb-plugin-provider-claude-code#test`.
     One consequence worth its own test: with claude-code out of the
     restorable seed table, the `sessionRestorable` a bridge reports on
     `thread/start` is the ONLY thing that lets the idle sweep release a
     graduated provider's session, and nothing covered that path — the
     process-lifecycle reaper tests now report it on the wire.
     Still id-switched in core after the wave, deliberately: the four-variant
     skill-root union and `runtime-skill-roots.ts`'s per-provider normalizers
     (they ride the wire as data; collapsing them is the deferred
     `skills/configure` work), `isAcpProviderId` (used by those normalizers,
     by the steer-stale recovery, and by the server's ACP tier), the
     `acp-launch-specs.ts` cursor table, and the runtime's deliberate codex
     error-text special cases audited and kept in wave 3.
     KNOWN RED, PRE-EXISTING, NOT ADDRESSED BY THIS WAVE: the
     `@bb/agent-runtime#test:integration` suite (live CLIs, not in CI)
     constructs providers straight from `createProviderForId` with no
     `bridgeLaunch`, so every graduated provider now fails there with
     "Unsupported provider". Codex broke it first; claude-code and acp extend
     it. The harness needs the same built-artifact wiring the integration
     harness just got, and it belongs to the final gate's live QA matrix.

FINAL VALIDATION GATE (mandatory before calling graduation done): full
multi-agent adversarial review of the graduation diff — DONE, and all
eight confirmed findings are fixed with red-verified tests (full-tree
typecheck + test green):
1+6. `thread.archive` / `thread.unarchive` carried no `bridgeLaunch`, so
every graduated provider threw "Unsupported provider" — unarchive
always (it runs on a fresh provider-maintenance runtime), archive
whenever the thread's process was not already live. Threaded end to
end like `thread.start`: wire field, server attach, daemon artifact
resolve, runtime process key + adapter. 2. The codex account-restart re-resume rebuilt from `ThreadRuntimeConfig`,
which stored no launch, so it killed the thread's process and then
failed to rebuild it. The config now carries the launch (archive and
unarchive fall back to it too). 3. The codex bridge never retracted `thread/openWork` on child exit, and
the runtime's view is level-triggered, so the thread was never
idle-reaped. Child exit now clears the dead child's translator state
and re-reports. 4. Known and custom ACP agents were listed independently of the registry,
but their only bridge is the ACP plugin's; with that plugin disabled
the picker offered agents whose first turn died on the daemon. The
dynamic ACP tier is now gated on a registered ACP provider plugin. 5. The listener serves before plugins load, so provider-routed work saw
an empty registry on boot (409 `no_provider_available`, empty provider
list, turns dispatched with no `bridgeLaunch`). The registry now has a
bounded settlement gate the server resolves when plugin startup
settles, awaited by thread create, command building, provider listing
and model loads. 7. ThreadDetailView read the execution-options cache non-reactively for
fork/edit affordances; it now subscribes to the query cache. 8. The skills library labelled every custom ACP agent "ACP provider"; it
now names providers from the server roster.
A SECOND, EXTERNAL comparison review then raised six more findings, all
re-verified against current HEAD with the refute-by-default discipline
(several resembled pre-graduation claims that had been refuted then; the
code had since changed, and this time most were real). Five confirmed and
fixed with red-verified tests, one commit each; one part refuted:

1. CONFIRMED — declaration/implementation binding. A declaration alone
   made a provider listable and thread-creatable. A bridge build failure
   on a mutable-source plugin left the plugin "running" with the failure
   as a status detail and its provider in the picker (git installs fail
   hard and npm installs require a prebuilt bundle, so only that path was
   open); `kind: "router"` did the same by construction, since routers
   have no bridge and nothing anywhere resolves one. Either way
   `resolveBridgeLaunchForProviderId` failed open and the first turn died
   on the daemon with "Unsupported provider". Registration now demands an
   implementation — this load's artifact, or a daemon-bundled id — and
   `kind`/`bridge` are gone from the declaration contract:
   `bridge.entry` was validated and never bound to anything (all four
   first-party plugins passed the placeholder "provider-bridge"; the real
   entry is the manifest's `bb.providerBridge`). The daemon-bundled set
   now lives once, on the host contract both sides read.
2. CONFIRMED — first-party id squatting. Collision rejection only covers
   ids registered right now, so a disabled (or failed, or not-yet-loaded)
   official plugin left its id free. For `pi` that is more than a name:
   the runtime refuses artifact routing for bundled ids, so a third-party
   "pi" would have supplied metadata for bb's own bundled bridge. The
   four ids and the `acp-` prefix are now reserved to their official
   plugin, enforced at declaration time and in the registry.
3. CONFIRMED — no lifecycle validation at the host boundary.
   `translateEvent` was a shape-only zod parse straight into runtime
   state; the only grammar rule anywhere was the turn-replay filter.
   `ThreadEventGrammar` now applies the conformance kit's rules as a
   streaming machine at intake (the kit's `checkItemOpensBeforeDelta` is
   that machine fed a log, so there is one implementation), dropping
   violations with a warning that names the rule. It replaces the replay
   filter, whose completed-turn state it subsumes. An item that settles
   without opening is kept rather than dropped: it carries the whole item
   payload, so refusing it would lose real content — and the fake bridge
   in the runtime's own tests emits exactly that shape. Ownership: the
   single-thread fallback in event thread-id resolution no longer accepts
   an id naming another live thread.
4. PARTLY CONFIRMED — resource bounds. The prior refutation ("server-side
   caps bound the artifact download") no longer held: there was no cap on
   a bridge bundle anywhere, and the daemon buffers one whole to verify it
   before executing it. Capped now on the wire contract and enforced at
   both ends. The stdout JSON-RPC line was genuinely unbounded on BOTH
   sides of the pipe (`readline` has no maximum); `readBoundedLines`
   replaces it and also strips CR, which the stdout path never did.
   REFUTED — the daemon event-sink queue: unbounded on purpose and
   documented as such (it holds every host thread's events across a
   delivery stall and must not drop them), with depth/age tripwires that
   already warn.
5. CONFIRMED — process identity and retirement, both halves. The process
   key carried the artifact hash but not the declaration facts baked into
   the adapter at spawn, so a plugin editing its declaration without
   rebuilding its bundle kept serving new threads from the superseded
   adapter; and the stale-hash sweep ran only on `ensureProvider`, so a
   superseded process still owning a thread was skipped and never
   revisited. A capabilities+options fingerprint now rides the key (and
   the daemon's model-list runtime cache), and the release path — which
   already retired thread-scoped codex processes — retires superseded
   bridge processes too.
6. CONFIRMED — fork was constructed unconditionally. The runtime gated on
   the declaration's `supportsFork` and never read the handshake's
   `fork`, which the protocol doc calls the operative truth: a `"none"`
   bridge was sent forks it never promised to reject, and a `"tip"`
   bridge got checkpoint forks. The adapter now rejects both before
   dispatch, and the start path builds its plan inside the try so a
   rejected fork takes the normal failed-construction cleanup.

Remaining: conformance all
green for all five bridges (the codex pin must be flipped, not deleted);
calibration suites re-run as bridge-only self-consistency checks; a full
live QA matrix with real CLIs covering the previously-missed paths
(skills, accept-edits write roots to thread storage, steer/stop/resume,
fork, archived resume, models) plus plugin disable/re-enable and a
plugin-update (new artifact hash) mid-session; a fresh-install QA pass
(empty data dir); process-tree and orphan sweeps; and CI green.

## Post-graduation simplification (2026-08-15)

Graduation left every bridge dual-dialect: each carried a per-session
`"legacy" | "canonical"` switch, a nullable translator, and a second params
schema per method, because the deleted adapters used to be the other consumer.
One commit per provider removed that, after proving the legacy arms had no
driver left. The proof is short: `bridge-protocol-adapter.ts` is the only
runtime→bridge request builder and always sends canonical params, and the only
other live client was the tarball smoke — which sent `{clientInfo}` to all four
bridges and drove pi's whole E2E in the legacy dialect. The smoke now speaks the
canonical protocol (handshake, session construction, `turn/start`, release
`thread/stop`) and asserts translated `thread/event`s; its pi turn waits for
`turn/completed{status:"completed"}`, so an interrupted or failed turn fails
loudly instead of satisfying the wait.

Net: **-1,190 lines** across the four commits (2,874 added, 4,064 removed),
with every suite green (agent-runtime 311, acp 138, codex 162, claude-code 260,
protocol 70), full-tree typecheck, full-tree test, and `smoke:tarball`.

What died beyond the dialect switch itself:

- **The internal params zod round-trip (pi, acp, claude-code).** Each canonical
  handler built an untyped record shaped like the _legacy wire_, re-parsed it
  through the legacy zod schema, and mapped it again before it became session
  options. The builders now return the typed params they always described.
  Pi's was the worst: env vars made a full round trip out to
  `shell_environment_policy.set.*` config keys and back through
  `extractEnvOverrides`, so the kit grew one `buildShellEnvOverrides` that
  `buildShellEnvironmentPolicyConfig` (still needed by codex) delegates to.
- **A latent bug the union hid.** The legacy schemas were non-passthrough and
  sat _second_ in each union, so a canonical request that failed validation for
  any reason fell through to them, got `options` stripped, and was silently
  served in the legacy dialect instead of answering INVALID_PARAMS.
- **ACP `thread/compact`.** The handshake reports `manualCompaction: false`, so
  the runtime never sends it; the method existed only in the legacy dialect.
  `startCompaction`, both compaction notification methods, their schemas, and
  the translator's two compaction arms went with it. **This one was a
  regression** — see "ACP manual compaction" below; the mechanism is back, and
  only the dead `thread/compact` request method stayed deleted.
- **ACP `acp/permission/request`.** Superseded by canonical
  `interaction/request`; its params schema already had no importer at all.
- **claude-code `inputGroups`.** Canonical turn params carry one flat input
  list and `buildClaudeTurnParams` never emitted groups, so the multi-prompt
  queueing path was unreachable.
- **claude-code resume with a null `providerThreadId`.** Canonical resume names
  the session it reopens; it is now INVALID_PARAMS rather than a silent fresh
  session.
- **Two codex pass-through modules.** `permission-mapping.ts` (one importer, no
  test of its own) merged into `interactive-requests.ts`; `subagent-activity-
translation.ts` (one importer, and no possible second — the tracking state
  lives in the translator's closures) merged into `translator.ts`. Fifteen more
  codex exports were module-internal in practice and are now declared so.
  Three that looked identical are deliberately still exported: they are pure
  functions with real unit tests, and routing those assertions through a caller
  would test less.

Test-side consequences worth keeping:

- The bridge suites drove the legacy dialect end to end, so they moved to the
  wire the bridges now speak. ACP's model discovery runs the agent binary
  itself (what a launch-spec-derived list command always does), so the fake ACP
  agent grew a `--list-models` mode.
- Some cases could not be migrated because the canonical wire cannot express
  them, and each deletion is a statement about reachability, not a coverage
  cut: ACP's three manual-compaction tests (the method is gone), claude-code's
  grouped-input tests, and four claude-code cases driving Claude's
  `default`/`dontAsk` permission modes — no bb permission policy maps onto
  either, and the hook-level readonly-Bash suite in the same file already
  covers that rewrite in depth. One test is new on the other side: ACP session
  construction without a launch spec must fail with INVALID_PARAMS, the one
  degradation that bridge must not make.

Two things were audited and deliberately left:

- The translator options `turnIdPrefix`/`itemIdPrefix`/`synthesizeItemStarted`
  are optional in all four providers, and production now always sets all three;
  the un-prefixed, no-synthesis behaviour survives only in the translator unit
  suites. Making them required is a real deletion, but it would rewrite id
  assertions across ~4,000 lines of three translator suites for no behaviour
  change, so it is left as a follow-up.
- `thread/compact` reached nothing on ANY provider: the runtime adapter has no
  compaction command at all, so pi's and codex's implementations were
  unreachable too. ACP's went first (its handshake declares the capability
  false), and the canonical method itself has now been deleted — schema,
  `BRIDGE_REQUEST_METHODS` entry, and both remaining bridge handlers. Manual
  compaction is not lost: it travels the prompt path as a standalone builtin
  `/compact` mention through the normal turn pipeline (codex maps it to
  `thread/compact/start`), and the `manualCompaction` handshake fact plus the
  declared `supportsManualCompaction` still gate the UI affordance. A
  structured trigger is future work; the protocol is unshipped, so
  reintroducing one costs nothing — but only with a sender.
- Pi's prompt-path compaction was missing and is now implemented. Deleting the
  dead `thread/compact` exposed that pi's `turn/start` never inspected its
  input, so bb's compact affordance sent the literal text `/compact` to the
  model (pi's own `/compact` is an interactive-mode command the SDK path never
  sees). Verified live before the fix on `openai/gpt-5.4-mini`: the model
  answered "Memory compacted: codeword is ALPHA…", no `thread/compacted`, and
  context grew 4,890 → 5,148 tokens. The pi bridge now runs the same
  `isStandaloneBuiltinCompactCommand` check codex uses and drives
  `PiSdkSession.compact()` (previously unreachable code, now the sole caller);
  the existing translator arms turn `compaction_start`/`compaction_end` into
  the maintenance turn, and the settle report closes the turn when pi refuses
  outright. Verified live after the fix: `thread/compacted`, completed turn,
  and context 53,691 → 20,215 tokens. Pi reports unknown context usage for one
  turn after compacting (its own `getContextUsage` distrusts pre-compaction
  assistant usage), so the meter clears before it drops. Pi refuses to compact
  sessions below its `keepRecentTokens` (20k default) with "Nothing to compact
  (session too small)"; that surfaces as a failed turn, so the declared
  `manualCompaction: true` is honest but small threads see an error rather than
  a no-op.
- **ACP manual compaction was a graduation regression, now restored.** Twin of
  the pi one, but with an extra misjudgment. On `origin/main` the legacy ACP
  adapter intercepted a standalone builtin `/compact` and sent
  `thread/compact`, and the bridge ran it as a provider-local maintenance
  prompt (`session/prompt` with `/compact`, which is exactly how OpenCode
  exposes its built-in compaction over ACP). Graduation deleted the sender;
  the simplification commit then deleted the handler, reasoning from the
  bridge's own `manualCompaction: false` handshake — but that fact was stale
  bookkeeping, not the gate. Wave 4 made ACP compaction a **per-agent
  server-side declaration** (`KnownAcpAgent.supportsManualCompaction`,
  `customAcpAgents.supportsManualCompaction`), and
  `providerRegistry.supportsManualCompaction` is what gates the affordance and
  the `POST /threads/:id/compact` action. So the bridge deleted the only code
  that could serve a request the server still allows for `acp-opencode`: live,
  `/compact` reached the model as literal text.
  The ACP bridge's `turn/start` now classifies the input with
  `isStandaloneBuiltinCompactCommand` and drives the same maintenance prompt;
  `activePromptKind` (`"turn" | "compaction" | null`) came back with it, the
  compaction envelopes and the translator's two arms are restored, and the
  handshake now reports `manualCompaction: true` — that is a process-level
  fact about what this bridge implements, decided _before_ any session exists,
  so it cannot answer the per-agent question; nothing consumes it (there is no
  compaction request method to gate), and the comment says so.
  Per-agent honesty: an ACP agent's `available_commands_update` is **not** a
  usable gate — OpenCode lists only its custom commands there and never its
  built-in `compact` (probed live), so a first attempt to gate on it failed
  the very case being restored. The gate stays the server-side declaration,
  and the bridge reports the agent's own outcome: only an `end_turn` prompt
  yields `thread/compacted`; every other stop reason or a rejected prompt
  fails the turn with the agent's reason.
  Verified live on `acp-opencode` (`thr_sgpr2zdbjz`): `item/started`
  `contextCompaction` → real OpenCode summary → `thread/compacted` → completed
  turn, with context 10,612 → 2,491 tokens.
  Audit of the other adapters: `origin/main` had exactly three builtin-command
  interceptions (acp, codex, pi), all `isStandaloneBuiltinCompactCommand` in
  `turn/start`. Codex's canonical equivalent shipped with its bridge, pi's was
  restored in 7d726a0f2, and acp's here; claude-code never had one (its CLI
  handles `/compact` in the prompt text natively). No other orphans.

## API pass, rebase, and adoption pass (2026-08-17)

### The API pass (items 1–10, complete)

Ten approved changes to the provider-facing contracts, one commit each,
before any of them ships to a third party. The theme is one noun set and one
answer per question, from the plugin declaration through the registry to the
host wire:

1. **One fork ladder.** `fork: "none" | "tip" | "checkpoint"` replaces the two
   declared booleans; `ProviderInfo` still carries the projected pair clients
   gate on, and the daemon gets the ladder itself because the handshake
   narrows against it.
2. **One noun set, declaration → daemon.** The wire's capability block shares
   the declaration's names, so the projection is a copy rather than a rename
   table.
3. **Handshake capabilities named after the methods they gate**, so a bridge
   cannot advertise a fact no method consumes.
4. **`manualCompaction` dropped from the handshake.** It is a per-agent
   server-side declaration; a process-level handshake answered before any
   session exists cannot speak for it.
5. **`bridgeLaunch.providerOptions` deleted** — never sent, never read.
6. **`bridgeLaunch` required, with an honest source union**
   (`artifact` | `daemon-bundled`) instead of a delivery path inferred from an
   absent field.
7. **One icon grammar**, flattened.
8. **The host-AI-services provider capability dropped.**
9. **`supportsManualCompaction` read from the projection**, not from a raw
   declaration stashed on the registration. That was the stash's last reader,
   so the field is gone: `ProviderRegistration` now carries only projected
   shapes, and there is no way to answer a capability question twice.
10. **The ACP tier's capability constant read directly.** Three registry
    accessors and the bridge-launch resolver were each building a throwaway
    `ProviderInfo` — placeholder display name, null logo — to reach one
    boolean.

### The rebase (protocol 130)

Rebased onto main with PR #1686's host plugin foundation merged. One protocol
bump for the whole branch: **HOST_DAEMON_PROTOCOL_VERSION 130**, covering the
required `bridgeLaunch` and the collapsed `host.delete_skill` provider scopes.
SDK 0.4.8.

Flag-checked from the rebase: main narrowed `onDaemonSocketOpen`'s deps to
`hub | logger | sharedPorts | terminalSessions`. Nothing of ours was lost —
the removed deps served `schedulePrimaryHostCaffeinateReconciliation`, which
moved into the Keep Awake host plugin, and no provider-bridge behavior runs at
daemon connect (bridges are pulled on demand at command dispatch, never pushed
at socket open).

### The adoption pass

The foundation arrived with generic mechanisms for problems the provider
branch had already solved privately. The principle, stated by Michael: **the
platform layer must not contain provider-named plumbing; providers are a
feature consuming generic capabilities.** So the convergence runs in that
direction — their generic function absorbs our contribution, rather than two
functions living side by side.

- **One artifact cache.** `PluginHostManager.materializeArtifact` and
  `ensureCachedProviderBridge` did the same job with half the safety story
  each. They collapse into `ensureCachedNodeArtifact` (a free function with an
  injected fetch, `apps/host-daemon/src/node-artifact-cache.ts`); bridges
  contributed the in-flight dedupe map and retry-on-verification-failure,
  plugin hosts contributed the 0o600 staged write and stale pruning, and both
  now have all four. Pruning is the one real difference and is therefore a
  parameter: a plugin runs one host bundle at a time
  (`keep-only-current`), while several bridges run at once and an artifact
  launch names only a sha256, so bridges prune by disuse
  (`keep-recently-used`, 30 days, touched on every launch). Pruning bridges to
  "the current digest" would delete a live sibling's bridge on every launch
  and ping-pong the downloads forever.
- **One byte ceiling, zod-free.** `MAX_PROVIDER_BRIDGE_ARTIFACT_BYTES` and
  `HOST_ARTIFACT_MAX_BYTES` were the same 256 MiB written twice on opposite
  sides of the contract package. Ours is deleted; theirs, in `protocol.ts`,
  is now the one cap for any executable artifact delivered to a daemon.
  `DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS` moved beside it.
- **One spawn env.** `pluginHostProcessEnv` folds into
  `sanitizeInheritedChildProcessEnv`, which gains an optional `shellPath`
  (omission means "keep the parent's PATH" — a real distinction for a child
  that must run exactly what the parent runs). Bridges already spawned through
  that helper and already received the login-shell PATH via the RuntimeManager
  overlay, so both daemon-spawned plugin process kinds now answer the question
  identically; host workers additionally stop inheriting `NODE_ENV`.
- **One artifact-serving shape.** Both internal routes go through
  `hostArtifactFileResponse`: streamed from disk, length-checked against the
  recorded `byteLength`, immutable cache headers, indistinguishable 404. The
  bridge route's per-request full read and re-hash is gone — it bought nothing
  the daemon does not already do, and cost a full buffer per fetch per
  enrolled daemon. On the client side `fetchProviderBridge` adopts the plugin
  host bundle's bounded reader (it now takes the expected length it always had
  at the call site), so a lying stream is cut off mid-body instead of after
  allocation.
- **Plugin-scoped paths, half-adopted, honestly.** The dataDir/tempDir layout
  is extracted from `PluginHostManager` into `plugin-process-paths.ts` with a
  `kind` discriminator. Bridges do **not** adopt it yet, and the reason is a
  gap rather than an oversight: an artifact `bridgeLaunch` names a sha256 and
  nothing else, so the daemon cannot tell which plugin owns the bridge it is
  about to spawn, and no bridge has anything to put in such a directory today.
  Wiring dirs through now would be an accepted-but-ignored surface. Both halves
  resolved in phase 3, where bridges became host-artifact exports and arrive
  named by their plugin; the `kind` discriminator landed a new value
  (`bridge-data`) rather than a rename, and the module itself moved to
  `@bb/process-utils` because the two bootstraps live in different packages.

Deliberately **not** done in the adoption pass: the `bb.host` second-consumer
reshape (bridges as host-artifact exports). That is phase 3 below, and it is
what unblocked plugin-scoped bridge directories, prune-to-current for bridges,
and full convergence of the two artifact registries and their serving routes.

### Phase 3 — DONE (2026-08-17)

`bb.providerBridge` is gone. A provider bridge is a `bb.host` artifact that
happens to speak the bridge protocol, and every duplication the adoption pass
could only narrow is dissolved: one live-artifact registry, one internal route,
one daemon cache with one pruning policy. Three commits.

1. **The publish surface.** `@get-bb/plugin-sdk/provider-bridge` — one curated,
   hand-named module (never `export *`) carrying the bridge entry contract, the
   protocol's methods and param schemas, the bridge kit's authoring half, and
   the `@bb/domain` event vocabulary the payloads are made of (~190 names). Two
   decisions, both in `docs/api_to_audit.md`:
   - **Not** in `HOST_ARTIFACT_RUNTIME_STUBS`. That table is for surfaces whose
     runtime the host must implement because the SDK is a type-only
     devDependency; this one is pure schema and helper code with nothing
     daemon-pinned, so a provider plugin depends on the SDK for real and the
     artifact build inlines its published bundle. Pinned by a build test that
     asserts both the absence from the table and that no `@bb/` import survives
     into the artifact.
   - The **domain event types are named, not moved**. `@bb/domain` is bb's
     persisted-thread vocabulary shared by server, app and runtime; moving it
     into the plugin SDK would invert the dependency and hand the SDK the
     product's core domain. The SDK is already exactly this facade for
     `PromptInput` and friends at its root export, so this is the existing
     precedent rather than a new one. The audit entry states what to settle
     before the shapes are a public promise, and flags the two other honest
     smells: surface size (several names exist for one first-party bridge) and
     `hostDaemonAcpLaunchSpecSchema`, the one core wire shape a bridge parses.
2. **The bridges.** All four first-party bridges and echo-provider export
   `experimental_providerBridge` instead of starting themselves; their manifests
   move `bb.providerBridge` → `bb.host`; 34 bridge-reachable files swap private
   `@bb/*` imports for the published surface. The inversion is what lets one
   artifact carry both a bridge and a host RPC entry — echo-provider proves it,
   `host.ts` re-exporting the bridge and default-exporting a one-method RPC
   entry, with a test pinning both — and what lets a test import a bridge
   without it taking over stdio, which the conformance suites already relied on
   by accident. Pi takes the same export shape but stays daemon-bundled.
3. **The bootstrap, the swap, the deletions.** `bridge-worker-entry.ts` is what
   the runtime spawns for every bridge: argv `<module> <pluginId> <dataDir>`,
   import, find the export or fail naming the plugin, hand it its plugin-scoped
   directories, wire the bounded stdio framing and signals. It completes the
   adoption pass's half-adopted plugin-scoped paths (`plugin-process-paths`
   moves to `@bb/process-utils`; the daemon spawns host workers, the runtime
   spawns bridges, and both bootstraps must agree on the layout). It lives
   beside the protocol, not in the daemon, because the runtime is what spawns a
   bridge — the daemon's `plugin-host-worker.ts` is its twin, not its home.
   `resolveBridgeLaunchForProviderId` reads the plugin's live host artifact and
   registration-requires-implementation demands one. Deleted: the manifest key
   (domain schema, server manifest, CLI, dev loop, builtin copier, npm
   prebuilt-bundle rule), `buildPluginProviderBridge`,
   `ProviderBridgeArtifactRegistry`, `readPluginProviderBridgeArtifact`,
   `loadProviderBridgeCandidate`, `GET /internal/provider-bridges/:sha256`,
   `ServerClient.fetchProviderBridge`, and the daemon's `provider-bridges.ts`.
   `PluginHostArtifactRegistry` is the one live map — no longer private to the
   plugin runtime, since both consumers and the one route sit outside it — and
   `ensureCachedPluginHostArtifact` the one daemon cache, with bridges
   inheriting `keep-only-current` (the disuse policy existed only because a
   launch named a bare hash).
   Wire, folded into the unshipped **protocol 130** with a ledger update and no
   new bump: `bridgeLaunch` carries `pluginId`, and its artifact source speaks
   the host artifact's `digest` vocabulary instead of `sha256`. A launch with no
   owning plugin fails the schema — it names neither an artifact to fetch nor a
   directory to scope the process to.

Validated: full-tree typecheck and test (agent-runtime 313, host-daemon 593,
server 1718, contract 52, integration 55, codex 162, claude-code 260, acp 144,
echo 2, protocol +5 bootstrap cases), lint, and `smoke:tarball` — whose bridge
smokes now drive the packed bootstrap against `dist/host.js`, which is the real
launch path rather than a bridge spawned by hand.

## Design notes from the #1641 prototype comparison (thr_fxnmqjf9a4)

The provider-driver prototype (#1641) was reviewed side by side with this
branch; its migration approach was rejected (all-provider cutover, no
fallback, 109 commits behind) but several kernel ideas are worth adopting
at graduation or in phase 6. Dispositions:

- Already covered here in equivalent form: declaration-as-ceiling with
  handshake narrowing (its inspect/declare split); bounded artifact
  downloads (server-side caps — the daemon-side streaming claim was
  refuted in review); server-owned DI registry; content-addressed,
  hash-verified artifacts.
- Adopt at graduation, when the runtime boundary hardens: a runtime
  lifecycle validator in the generic adapter (enforce start-before-delta,
  single settlement, id ownership at runtime rather than only in the
  conformance kit); host-minted turn/item ids (today bridges mint with
  entropy prefixes — validation, not minting, is the gap).
- Adopt in phase 6 / as the third-party surface matures: framed transport
  on dedicated fds with bounded queues (stdout corruption is currently
  mitigated per-bridge, e.g. pi's stdout takeover); artifact cache
  leases + GC and per-file rehash before launch; multiple named bridges
  per plugin; namespacing third-party provider ids by plugin.
- Rejected: exact-version protocol lockstep (hostile to independently
  updated plugins; we keep the versioned handshake), process-wide SIGKILL
  on attachment-local errors.

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
   `ProviderExecutionContext` (`claudeCodePermissionMode`).

**ACP** is the only extension point: a pure-data launch spec
(`hostDaemonAcpLaunchSpecSchema`) resolved per command — from `config.json`
for custom agents, from the in-repo `KNOWN_ACP_AGENTS` table (a code change)
for known ones — and run by the generic ACP bridge. It works, but the path
is deliberately least-common-denominator: no `auto` permission mode
(ACP threads default to `full`), no token usage, no plan/goal composer
modes, no command-shaped scan roots (native _skill_ typeahead does work),
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

| Lesson (incident)                                                                                                                                                                                               | Design requirement                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 87 protocol bumps in ~14 months (26 → 121); translation fixes require daemon deploys                                                                                                                            | Bridges version independently of the daemon. `initialize` negotiates `{protocolVersion, capabilities}` both ways; unknown methods/fields degrade, never crash.                                                                                                                                                 |
| Idle reaping was Codex-only by accident (#1604); process-key scheme encoded eligibility                                                                                                                         | Process cardinality stops being a bb concept: one bridge process per (provider, environment), sessions multiplexed within. Release is uniform — `thread/stop {intent: "release"}` per session, restorability from the handshake/session report — and any internal child topology is the bridge's own business. |
| Release vs interrupt conflated (#1584)                                                                                                                                                                          | Protocol `thread/stop` carries `intent: "interrupt" \| "release"` from day one.                                                                                                                                                                                                                                |
| Turn settlement gaps — repeated fixes (#1196, #1234, #1321, #1432), still no watchdog                                                                                                                           | Runtime (single owner of the turn state machine) keeps the accepted→dispatched→started→completed states; add the missing **turn-start watchdog** (visible failure if no `turn/started` within a bound).                                                                                                        |
| Session replaced as silent side effect of config diff (#1268, #1236)                                                                                                                                            | No core-side option diffing at all: the bridge owns reconciliation, and session replacement must be **reported** (session-replacement notification + settlement events), never silent.                                                                                                                         |
| Provider-minted ids trusted as bb ids froze a host for 30 min (#1320)                                                                                                                                           | Protocol schema forbids the bridge from minting bb turn ids; only caller-vouched ids scope events. Diagnostic events are droppable by construction.                                                                                                                                                            |
| Silently dropped undecodable JSON-RPC → 30s timeouts (#853)                                                                                                                                                     | Conformance rule: undecodable → `-32602` reply with issues; unknown method → `-32601`; request/response discriminated on `method`.                                                                                                                                                                             |
| Per-session item-id counters collided across resumes → permanent 500 (#1224)                                                                                                                                    | Conformance rule: item ids unique across resume (turn-scoped with per-instance entropy); projection degrades, never throws.                                                                                                                                                                                    |
| Normalized events with divergent shapes: pi/claude/acp open assistant text with bare `item/agentMessage/delta`, no `item/started`; timeline window cuts dropped the earlier deltas (fix in flight: `6e4628e9e`) | Conformance rule: every item's first event is `item/started` — bridges synthesize it when their SDK streams delta-first. The projection backfill stays for persisted history but becomes legacy-only.                                                                                                          |
| One bad entry or unknown enum member took down whole listings (#1044 null-for-absent, #580 new enum members, #1148 throwing extension loader)                                                                   | Protocol schemas are lenient at the edge (soft-parse unknown enum members, null-tolerant); one malformed entry degrades to one missing entry.                                                                                                                                                                  |
| Ambient env leaks (`BB_THREAD_STORAGE`, Volta, Electron, fnm churn) (#1366, #1545, #1156)                                                                                                                       | Bridge env is **constructed by one allowlist function**; the daemon's own env is not reachable from provider-facing code.                                                                                                                                                                                      |
| Same binary name, wrong CLI (#1231); launch drift not in process key                                                                                                                                            | Process identity = hash(bridge artifact + declared exec inputs + env overrides + providerId), generalizing the ACP fingerprint to every provider.                                                                                                                                                              |
| Cross-provider features shipped to half the matrix (#1374: rate limits 2/4, compaction 19 commits)                                                                                                              | One implementation site: a feature is a protocol method + declared capability; participation is machine-checkable, not grep.                                                                                                                                                                                   |
| One shared decoder bug hit three bridges at once (#853)                                                                                                                                                         | The shared protocol library gets tests proportional to fan-out: the conformance kit runs against **every** bridge in CI.                                                                                                                                                                                       |

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
- **Skills live in the bridge too, in both directions.** _Injection_
  (bb skills → provider): `skills/configure` carries one canonical payload —
  the staged catalog root plus skill descriptors — and each bridge
  transforms it into its provider's native shape (claude-code writes its
  plugin directory + generated manifest, codex/pi point at the skills
  directory, acp builds its prompt listing). This deletes today's
  three-layer per-provider switch in core: `injected-skills.ts::buildSkillRoots`
  (four hardcoded shapes), the `runtime-skill-roots.ts` normalize/filter
  switch, and the four-variant skill-root union in `agent-runtime/types.ts`.
  The daemon keeps only the generic content-addressed staging (symlink-safe
  copy, hashing), which is genuinely host infrastructure. _Discovery_
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

| Member                                                                          | Becomes                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `displayName`, `capabilities`                                             | declaration data                                                                                                                                                                                                                                                            |
| `approvalRequestPolicy`                                                         | handshake fact (`initialize` result)                                                                                                                                                                                                                                        |
| `process`                                                                       | uniform: `node <bridge entry>` from the bridge ref                                                                                                                                                                                                                          |
| `buildCommandPlan`                                                              | deleted — fixed protocol methods; the bridge maps internally                                                                                                                                                                                                                |
| `translateEvent`, `translateAcceptedCommand`                                    | deleted — bridge emits `ThreadEvent`s (accepted-user-message synthesis stays generic in runtime)                                                                                                                                                                            |
| `parseModelListResult`                                                          | deleted — protocol defines the `model/list` result schema                                                                                                                                                                                                                   |
| `decodeToolCallRequest`, `decodeInteractiveRequest`, `buildInteractiveResponse` | deleted — canonical protocol schemas                                                                                                                                                                                                                                        |
| `classifyExecutionSettingsChange`                                               | deleted with no replacement — the runtime never diffs options; the bridge reconciles internally, and rebuild visibility is the mandatory session-replacement notification. No declared scope table: #1610 removed its last server-side consumer (see the note in Design §3) |
| `normalizeExecutionOptions`                                                     | deleted — bridge-internal normalization                                                                                                                                                                                                                                     |
| `buildPostInitializeRequests`, `prepareTurnStart`, `clearActiveTurnState`       | deleted — bridge-internal or generic turn-state concerns                                                                                                                                                                                                                    |
| `buildThreadDetachedEvents`                                                     | generic: runtime reconciles from its own background-work state                                                                                                                                                                                                              |
| per-provider `visibility.ts`                                                    | deleted — bridge classifies before emitting `provider/raw`                                                                                                                                                                                                                  |

`ProviderExecutionContext` sheds every provider-flavored field.
`claudeCodePermissionMode` becomes the declared prompt-mode capability + a
normalized field; and `workflowsEnabled` / `memoryEnabled` /
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
  id: "claude-code", // stable; existing ids unchanged
  displayName: "Claude Code",
  icon: { asset: "icons/claude.svg" }, // served via existing plugin assets
  // No `kind` and no `bridge`: see the router note below. The implementation
  // is the plugin's manifest `bb.providerBridge` artifact, and registration
  // is refused without one (or a daemon-bundled id).

  // A capability is DECLARED only when it passes BOTH tests:
  //   1. a consumer outside the provider's own plugin needs the fact, and
  //   2. the fact is needed before / without a live session (picker
  //      rendering, route gating, cross-plugin tool composition — including
  //      with the host offline).
  // Maintenance-method availability is also declared here because core calls
  // those methods without a live provider session. Everything else is a
  // HANDSHAKE fact reported by the bridge at `initialize`, where it cannot
  // drift from behavior: the code that implements the feature is the code
  // that reports it.
  capabilities: {
    permissionModes: ["accept-edits", "auto", "full"],
    reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    // fallback ladder only; precise
    // per-model sets come from model/list
    supportsServiceTier: false, // fast/priority toggle in the picker
    supportsHostAiServices: false, // server routes voice/inference
    supportsNativeUserQuestion: true, // ask-user-question plugin skips its
    // duplicate tool
    supportsNativeFork: true, // fork affordance in the UI
    supportsNativeSessionRewind: true, // edit-past-message affordance
    supportsManualCompaction: true, // compact affordance
    experimental_providerHealth: true, // bridge implements provider/health
    experimental_providerUsage: true, // provider exposes subscription usage
    // MERGE CANDIDATE: fork + rewind may collapse into
    // `fork: "none" | "tip" | "checkpoint"` (rewind ≙ checkpoint fork) —
    // verify per provider how edit-message rewind is implemented before
    // merging. ACP is the motivating case: tip forks, no checkpoints.
  },
  composerActions: ["plan"], // just names. Skills typeahead is
  // universal (bb injects skills into
  // every provider) so it is implicit,
  // and the {trigger, name,
  // trailingText} boilerplate was
  // identical everywhere — the
  // composer owns the syntax.
});
```

**Moved to the `initialize` handshake** (session-behavior facts; reported by
the bridge, conformance-checked, drift-proof by construction):

- **archive/name sync**: the runtime skips `thread/archive` /
  `thread/name/set` for bridges that don't advertise them — which also
  deletes today's per-adapter unsupported-command noop plans.
- **session persistence**: already per-session on main (`sessionRestorable`
  on thread-identity results); the handshake supplies the default, the
  session report refines it.
- **`approvalRequestPolicy`**: a runtime branch consulted only when a
  session exists.
- **process scope — deleted, decided (Michael, 2026-08-14)**: a bridge's
  process topology is an implementation detail of that provider's plugin —
  it can use subprocesses or not. Every bridge presents to the runtime as
  one shared process per (provider, environment); the codex bridge spawns
  and manages per-thread app-server children itself. The runtime's process
  model collapses to a single shape, release/reap targets sessions
  uniformly via `thread/stop {intent: "release"}`, and memory reclamation
  for codex means the bridge kills that thread's app-server child.
  Precedent: the claude bridge already multiplexes threads in one process.
  Consequence: the bridge becomes a small process supervisor, so the
  child-process exit races the runtime learned to handle (#1402: finalize
  on `close` not `exit`, verify currency in stream callbacks) become
  conformance-kit material for bridges that spawn children.

**Deleted outright**: `promptModes` (duplicated `composerActions` — "has a
plan action" is the same fact), `executionOptionScopes`,
`supportsNativeWorkflows`, `executionOverride` (see notes above for each).

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
makes that resolution _indirect_: it appears in the model/reasoning pickers
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

- SUPERSEDED (adversarial review, see the gate below): `kind` and `bridge`
  are gone from the declaration. Nothing ever resolved a router, so a router
  declaration registered a picker entry whose every turn died on the host;
  and `bridge.entry` was validated but never bound to anything — the real
  entry is the manifest's `bb.providerBridge`. Reintroducing routers means
  reintroducing `kind` together with the resolver that makes it mean
  something.
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
- When the hooks ship, the thread executes and persists as the _delegate_
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
adapter and the new bridge import the _same_ translation modules — the code
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
   `event-translation.ts` + `schemas.ts` move largely verbatim). Its
   archived-session error handling becomes typed protocol errors, and its
   thread-scoped process topology becomes bridge-internal: one codex bridge
   per environment, spawning and supervising per-thread app-server children
   itself. `runtime.ts` loses every codex special case and the runtime's
   process model collapses to a single shape.

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

- DONE (wave 4) — `supportsManualCompaction` string list → capability. The
  protocol half already shipped in phases 1–2 (the `manualCompaction`
  handshake fact) and the plugin half in phase 4
  (`capabilities.supportsManualCompaction` on the declaration). What was
  left was the dynamic ACP tier's `MANUAL_COMPACTION_ACP_PROVIDER_IDS =
["acp-opencode"]` set, which is now a per-agent declaration:
  `KnownAcpAgent.supportsManualCompaction` and a `customAcpAgents`
  config field of the same name (default false). The registry cannot hold
  ACP declarations — they resolve from config per request — so it takes a
  `resolveAcpAgentCapabilities` dep, wired at the server boundary from
  `resolveAcpAgentCapabilitiesForProviderId` (custom agent wins over known
  agent, same precedence as the launch spec). Deliberate behavior change:
  a custom agent that shadows `acp-opencode` must now declare compaction
  itself instead of inheriting it from the id. The companion
  `thread/compact` request method was later dropped entirely (see the
  dialect-cleanup notes above):
  the capability gates the affordance, and the mechanism is the standalone
  builtin `/compact` prompt through the normal turn pipeline.
- DONE (wave 4) — `skillProviderSchema` closed enum → open provider id.
  Widening the provider field alone would have been cosmetic, because the
  scope vocabulary spelled the provider out a second time
  (`claude-user`/`codex-project`/`cursor-*`), so both moved: `SkillScope`
  and `EditableSkillScope` (server contract) and `deletableSkillScopeSchema`
  (daemon contract) collapse those six members to `provider-user` /
  `provider-project`. The daemon only ever distinguished bb roots from a
  server-supplied provider `rootPath`, so its handler is unchanged; wire
  change rides the unshipped v124 with a ledger entry.
  `mapSkillScope` loses both provider if/else chains, and the app composes
  the scope label from the skill's own `provider` field
  (`skillScopeLabel`) instead of a `Record<SkillScope, string>`.
  Deliberate UI change: the skills filter menu derives its provider rows
  from the listed skills (plus any selected filter) rather than a hardcoded
  four-entry table, so a provider with zero skills no longer gets a
  permanently greyed row. `SKILL_COMMAND_SURFACE_PROVIDERS` (which
  providers the server queries for skills) stays a server-side list — it
  becomes registry-driven with the `skills/scanRoots` item below, which is
  what actually teaches the daemon a new provider's roots.
- Daemon per-provider CLI tables (`provider-cli-health.ts`,
  `known_acp_agents.status`) → the optional `provider/health` /
  `provider/install` / `provider/update` bridge methods. The existing daemon
  tables keep working untouched through phases 1–5 and are deleted here.

  **DEFERRED from wave 4.** Same shape as `skills/scanRoots` and should ride
  with it: both are sessionless daemon→bridge reads over the maintenance
  runtime, both are currently daemon-local tables with no bridge involvement,
  and doing them in one pass means introducing the sessionless
  provider-query surface once instead of twice. Health/install/update is the
  more delicate half — install and update _mutate the host_ (`npm i -g`,
  `claude doctor`), and v118 already tightened update results to reject
  unverifiable successes, so moving that into plugin-supplied bridge code is
  a trust-boundary change, not just code motion.

- `PROVIDER_SKILL_SPECS` + `resolveProviderExtraRoots` → the optional
  `skills/scanRoots` bridge method with daemon-side caching. (The injection
  side is not deferred to this phase: the canonical `skills/configure`
  payload is part of the phase-1 protocol, and each bridge's native
  transformation moves in with the rest of its translation in phase 2,
  deleting `buildSkillRoots`, the runtime skill-root filter, and the
  skill-root union then.)

  **DEFERRED from wave 4 — this is a wave of its own, not a checklist
  item.** Scoped on the branch; the seam is clear and the sizing is not.
  What is actually there today, all in
  `apps/host-daemon/src/command-handlers/list-commands.ts`:
  `PROVIDER_SKILL_SPECS` is ~120 lines of declarative per-provider layout
  across 8 ids (user locations, project dirs, ancestor-walk lists,
  recursive vs flat, seeded vs unseeded identities), read by
  `resolveNativeSkillScanRoots` and `resolveParentSkillScanRoots`;
  `resolveProviderExtraRoots` is a SECOND ~55-line provider switch over a
  _different_ provider set for roots that cannot be static paths (codex and
  claude plugin-command roots, pi/omp/grok/hermes configured roots, the
  grok↔claude compat kill-switch); and `resolveProviderCommandScanRoots`
  branches root _ordering_ on `codex || claude-code`. Add the daemon-side
  `disabledDirectories` compat filtering and this is ~350 lines of
  provider-specific behavior, comparable to a phase-2 provider migration —
  except it must move into FIVE bridges at once, because a partial move
  leaves two discovery paths for one composer menu.
  The transport is not the hard part and is already precedented: a
  sessionless bridge call has a working path in
  `runtime-manager.ts::ensureProviderMaintenanceRuntime` +
  `runtime.listModels`, which `provider.list_models` already uses with the
  same `bridgeLaunch`/`acpLaunchSpec` plumbing; `skills/scanRoots` slots in
  1:1 there. What is unbudgeted is the fanout (five bridges), the caching
  policy (scan roots are consulted on every command/skill listing — today
  they cost no process), and the fallback when a bridge is unreachable.
  Also note the coupling recorded under `skillProviderSchema` above:
  `SKILL_COMMAND_SURFACE_PROVIDERS` cannot become registry-driven until
  this lands, because the daemon has no other way to learn a new
  provider's roots.

- `providerCliKeyValues` / fixed-key `providerUsageResponseSchema` → generic
  per-provider-id map backed by an optional `provider/usage` bridge method;
  usage-limits and CLI-install UI become registry-driven. **DEFERRED from
  wave 4** — third member of the sessionless daemon→bridge family above; do
  all three together.

- **DEFERRED from wave 4 — `getProviderIconColorClass` hardcoded colors →
  plugin icon components.** This one is genuinely blocked on new plugin-SDK
  surface, not on effort: the app-side deletion is 20 lines and 3 call
  sites, but every icon that reaches those call sites paints with
  `fill="currentColor"` and relies on the host's color class. Deleting the
  class means each plugin's icon must self-color, which contradicts what
  `PluginProviderIconRegistration` advertises ("receives the host's
  sizing/color className") and cannot express `acp-cursor`'s
  light/dark pair (`text-[#111827] dark:text-[#F5F5F5]`) without either a
  tint field on the registration (light+dark, a real contract question:
  format, validation, theme model) or a theme hook exposed to the app SDK.
  Either is an `experimental_` surface addition with a
  `docs/api_to_audit.md` entry. Flattening to monochrome instead would
  breach the phase-6 guardrail on exactly the two flagships.
  Two things ARE separable and cheap when this is picked up:
  `plugins/automations/lib/provider-icon.tsx` has no colors to preserve and
  no `logoUrl` support at all — 75 lines of inlined SVG that plain `logoUrl`
  support deletes; and `SkillsCollection.tsx`'s one-off
  `providerId === "codex" && "text-white"` dark-tooltip override.
- Host-daemon AI services (voice/inference, codex-only daemon commands) →
  optional protocol capability on the bridge.
- DONE (wave 4) — `hasOpenThreadWork` generic-adapter hook. The optional
  adapter member survived graduation with no canonical implementation: the
  codex translator computes it, but the translator moved into the codex
  bridge, so nothing in the runtime could ask. A codex thread whose only
  live work was a native subagent (a tool call, not a `backgroundTask`
  item) therefore looked idle and the session reaper stopped its process
  out from under a running child agent. Fixed with a level-triggered
  `thread/openWork` notification: the bridge reports the current value, the
  generic adapter keeps the last one per thread and answers
  `hasOpenThreadWork` from it, and a bridge that never sends it reads as
  idle (today's behavior for the other three). Additive, so no
  `PROVIDER_BRIDGE_PROTOCOL_VERSION` bump. The codex bridge also retracts
  the claim on session release, or the runtime would refuse to reap a
  thread that no longer exists on the bridge side.
- MOSTLY DONE (wave 4) — `thread-timeline-active-prompt-mode` enum +
  `thread-view` provider switches. The premise needed correcting: plan mode
  is not bridge-emitted at all, it is derived server-side from a `/plan`
  command pill, so "normalized event fields emitted by bridges" was the
  wrong shape. The right source already existed —
  `ProviderInfo.composerActions` with `kind: "plan"`, declared by exactly
  the two providers the hardcoded gate named.
  `threadTimelineActivePromptModeSchema.providerId` widened from
  `z.enum(["claude-code","codex"])` to an open id, and the extraction takes
  the declared `planCommand` (which replaces BOTH the id gate and the
  hardcoded `{trigger:"/",name:"plan"}` selector). The duplicate gate in
  `thread-runtime-display.ts::canThreadShowActivePlanMode` reads the same
  resolver. Plan mode now works for a plugin provider that declares it.
  `parse-operation-message.ts`'s four-provider `providerDisplayName` switch
  is DELETED — every caller already supplies the registry-resolved name.
  KEPT deliberately: `model-fallback-extraction.ts`'s `providerId ===
"claude-code"` guard. It is not policy — it decodes a legacy raw Claude
  SDK `sdk/message` payload for events that predate normalization, and the
  modern typed `provider/modelFallback` path sits directly above it.
  DEFERRED: `effective-prompt-mode.ts`'s Claude-only plan permission label
  ("Claude Code will plan without normal full-access execution") — that is
  per-provider _copy_, not a capability, and generalizing it means a
  declared string in the provider contract.
- DONE (wave 4) — `EDIT_MESSAGE_PROVIDER_IDS` → capability. No new
  capability was needed: `supportsNativeSessionRewind` was already declared
  by every provider plugin (and already documented as gating the
  edit-past-message affordance) with exactly the same answers as the
  hardcoded `["claude-code", "codex", "pi"]` set — it just had no consumer.
  It now surfaces as `ProviderInfo.capabilities.supportsSessionRewind`,
  answered by a registry accessor for the server gate and read from the
  cached provider info by the app's `canEditSentMessages` — the same
  `findCachedProviderInfo(...).capabilities` call the fork affordance
  forty lines above it already made. It stays separate from
  `supportsFork` on purpose: ACP forks tip-only.
- Onboarding and `SETTINGS_PROVIDER_ENTRIES` → registry-driven.

  **DEFERRED from wave 4 — needs product design, not consolidation.**
  Shares the missing piece with the provider-retry banner above and with
  the provider-scoped toggles below: there is no plugin-facing provider
  directory on either SDK surface, and a registry-driven settings page has
  to answer what a provider plugin may contribute to it. The guardrail bites
  hardest here — the Codex and Claude Code settings panes are the richest
  provider surfaces bb has, and a generic registry-driven pane that renders
  a flat capability list would flatten them. The likely shape is the
  opposite of a generic pane: each provider plugin owns its settings section
  through the existing settings-section slot, and the registry supplies only
  the entry (id, display name, icon, order). That is a phase-4/5 follow-on,
  not an enum cleanup.

- **DEFERRED from wave 4 — provider-scoped options for the claude/codex
  workflows, memory, and subagent toggles.** Still special-cased, and the
  special case is in the _storage shape_, not in a lookup that could be
  swapped for a capability: `appSettings` has five provider-named boolean
  COLUMNS (`codexMemoryEnabled`, `claudeCodeMemoryEnabled`,
  `codexSubagentsDisabled`, `claudeCodeSubagentsDisabled`,
  `claudeCodeWorkflowsDisabled`), read by three `providerId === …` helpers
  in `thread-commands.ts`. Generalizing means a per-provider settings map:
  a DB migration, an `AppSettings` wire change, a settings UI that renders
  declared toggles, a `bb settings` CLI surface, and — the actual design
  question — what a provider plugin is allowed to declare as a toggle and
  who owns rendering it. Same unanswered question as the settings entries
  above, so they should land together.
  One concrete inconsistency to fix when they do:
  `resolveProviderWorkflowsEnabled` gates on the declared
  `supportsWorkflows` capability but then reads
  `claudeCodeWorkflowsDisabled`, so a plugin provider that declares
  `supportsWorkflows: true` today silently inherits a Claude-named user
  preference. It is currently unreachable (claude-code is the only declarer)
  but it is a live trap for the first third-party provider.
- PARTLY DONE (wave 4) — Plugin-side provider id lists → capabilities read
  off `ProviderInfo`. The ask-user-question plugin's
  `NATIVE_TOOL_PROVIDER_IDS` is DELETED: `PluginAgentConfigurationContext`
  gained `provider.capabilities.supportsNativeUserQuestion`, filled at the
  server boundary from the registry (absent registration reads false, so
  the plugin contributes its own tool), which finally gives that declared
  capability a production consumer.
  DEFERRED — the provider-retry banner's `providerLabel` switch. It is a
  plugin _frontend_ component, and there is no plugin-facing provider
  directory on either SDK surface: `@get-bb/plugin-sdk/app` exposes no
  provider list/display-name hook, and `BbPluginApi` has no read side for
  the registry either. Fixing it means a new public plugin API member
  (`experimental_` + a `docs/api_to_audit.md` entry), which is new surface
  design rather than a consolidation. Do it with the settings/onboarding
  registry work, which needs the same directory.

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
bridge deserves the most caution of all — it is the only _new_ bridge and it
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
5. **Process scope** (2026-08-14): deleted from the contract entirely — a
   bridge's process topology (subprocesses or not) is an implementation
   detail of that provider's plugin. The runtime always sees one bridge
   process per (provider, environment).

## Appendix: Phase 2 anatomy — what the four adapters share and where the code moves

Each provider today is an in-core adapter (the 18-member `ProviderAdapter`)
plus, for three of four, a bridge child process:

| Provider    | In-core today                                                                                                                                                                                          | In bridge today                                                                                                               | Child process                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| claude-code | ~5.2k lines (adapter 1357, `translate-message.ts` 1073, `task-translation.ts`, `schemas.ts`, `interactive-contract.ts`, visibility 620, model list, error-info, sdk-extraction)                        | ~4.2k (`bridge.ts` 2109 wrapping the Claude Agent SDK, readonly-bash policy, session options, mock-CLI proxy, MCP tool proxy) | `node bb-claude-code-bridge.mjs`     |
| pi          | ~2.1k (adapter 1547, visibility, model list)                                                                                                                                                           | ~2.4k (wraps the Pi SDK)                                                                                                      | `node bb-pi-bridge.mjs`              |
| acp         | ~2.5k (adapter 1552, `wire.ts`, `bridge-protocol.ts`, visibility, profiles)                                                                                                                            | ~3.2k (generic ACP client, permission/fs policy, model catalog, MCP tool proxy)                                               | `node bb-acp-bridge.mjs` → ACP agent |
| codex       | **all in-core**: ~5.3k hand-written (adapter 2239, `event-translation.ts` 1095, `schemas.ts` 998, interactive requests, permission maps, visibility, models) + ~1.9k generated app-server schema types | none                                                                                                                          | `codex app-server` directly          |

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
   shapes, the mapping moves inside, and `approvalRequestPolicy` becomes a handshake
   fact (the runtime already supports both modes).
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
codex (the only _new_ bridge — it inherits the translation code verbatim,
but on the command side it is a method-mapping layer, not a passthrough: six
of its command→method mappings diverge from the bb bridges, see above; costs
one extra process hop, buys uniform lifecycle, the env allowlist, and
deleting the `runtime.ts` special cases). Only phase 1 involves design;
phase 2 is code motion pinned by tests, plus one canonical-mapping decision
per divergent command.
