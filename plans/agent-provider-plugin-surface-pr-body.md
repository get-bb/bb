# Agent providers as a first-class plugin surface

Implements [plans/agent-provider-plugin-surface.md](plans/agent-provider-plugin-surface.md) (phases 1–5). Providers declare their metadata through the plugin API and run as plugin-registered **provider bridges** speaking one bb-owned, provider-agnostic JSON-RPC protocol. The canonical path is gated by a single `providerBridge` experiment, **default-on**; the legacy adapters remain in place as the flag-off fallback until the per-provider graduation (deletion) PRs.

## What's here, by phase (commits are ordered to match)

1. **Protocol + kit** — `@bb/provider-bridge-protocol`: versioned handshake with session-behavior capabilities, canonical requests/notifications (including end-to-end `skills/configure`), error codes, an event-grammar doc, and a transport-agnostic conformance kit (12 rules, incl. full streaming-delta coverage and zero-work-prompt settlement).
2. **Four conformant bridges** — acp, pi, claude-code rewritten onto the canonical dialect (translation extracted byte-identically into shared modules both paths import); codex is the one new bridge, owning per-thread `codex app-server` children with the #1402 supervision rules. One generic `BridgeProviderAdapter` replaces per-provider adapter glue. Turn-start watchdog (`provider_turn_start_timeout`).
3. **Server registry + SDK** — `ProviderRegistryService` (catalog-equality pinned), `bb.agents.experimental_registerProvider`, and `app.slots.experimental_providerIcon` (plugins ship theme-aware React brand marks; `logoUrl` files remain for static color logos). Both have `docs/api_to_audit.md` entries.
4. **First-party plugins** — `plugins/provider-{codex,claude-code,pi,acp}` take over their core-seed entries in place (position preserved, restored on disable, takeover merge preserves flagship behaviors) and register their brand marks as app components. The app no longer depends on `@bb/agent-providers`.
5. **Third-party artifact delivery** — `bb.providerBridge` manifest key builds a self-contained bridge bundle; server stores/serves it content-addressed; daemon caches by verified hash; a verified `bridgeLaunch` (carrying the declaration's validated execution capabilities) is its own routing authority. `HOST_DAEMON_PROTOCOL_VERSION` 123 → 124 (the PR's only bump; main took 123 for artifact engine ranges). `examples/plugins/echo-provider` proves the path end to end.

## Verification

- **Live QA with real provider CLIs, three full passes** (pre-rebase, post-rebase, and a default-on gate): all four providers through the canonical bridges — spawn, two turns, steer/stop/resume, models — verified by process trees and event streams; plus the previously-unexercised paths: staged bb skills reaching claude-code and codex CLIs, accept-edits writes to thread storage, and a daemon-restart-under-stalled-server policy check. Zero error events, zero orphaned processes.
- **Multi-agent adversarial review**: 8 subsystem reviewers over the full diff plus verification of every external review comment; every finding survived only if a dedicated skeptic failed to refute it. All confirmed findings are fixed in this PR (artifact routing authority, capability transport, skills wiring, ACP/claude write roots, `/plan` mention stripping, daemon policy no-clobber with startup retry, prefix-hijack removal, conformance delta coverage, stale-hash process retirement, theme-aware icons). Refuted claims are documented in the thread.
- **Historical-bug audit**: ~30 past provider fixes classified; every invariant is bridge-tested, shared-by-construction, or has a dedicated new bridge-path suite (codex translator, ACP event-translation/interactions, pi `none`→`off`, claude rate-limit classification), each verified red before landing green.
- **Dual-path calibration replay** for all four providers: one scripted session per provider replayed through the legacy adapter and the canonical bridge, normalized event streams diffed by LCS. **No unexplained parity divergence on any provider** — only deliberate protocol differences (synthesized `item/started` openings; identity moving into the start response).
- Full-tree typecheck and tests green; CI green.

## Known gap (pinned, non-blocking)

The codex bridge does not yet settle a prompt the app-server accepts without emitting `turn/started` (the new zero-work-prompt conformance rule). It is pinned as the **only** permitted non-green rule in the codex conformance test and recorded in the plan; flipping it to pass is a graduation prerequisite — the fix needs a dispatch-ownership seam and must not fabricate turns from late signals.

## Not in this PR (deliberately)

Graduation itself — the per-provider legacy-adapter deletion PRs after soak — and the phase-6 consolidation sweep, both recorded in the plan's Remaining section along with the smaller follow-ups (env-var live-change semantics, fork-UI reactivity minors, ACP write-approval presentation).

> AGENT GENERATED: by Claude Fable 5
