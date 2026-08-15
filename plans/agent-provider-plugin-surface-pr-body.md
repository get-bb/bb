# Agent providers as a first-class plugin surface

Implements [plans/agent-provider-plugin-surface.md](plans/agent-provider-plugin-surface.md) (phases 1–5). Providers declare their metadata through the plugin API and run as plugin-registered **provider bridges** speaking one bb-owned, provider-agnostic JSON-RPC protocol. All new paths are gated behind a single default-off `providerBridge` experiment — merging this changes nothing for users until the flag is flipped.

## What's here, by phase (commits are ordered to match)

1. **Protocol + kit** — `@bb/provider-bridge-protocol`: versioned handshake with session-behavior capabilities, canonical requests/notifications, error codes, an event-grammar doc, and an 11-scenario transport-agnostic conformance kit.
2. **Four conformant bridges** — acp, pi, claude-code rewritten onto the canonical dialect (translation extracted byte-identically into shared modules both paths import); codex is the one new bridge, owning per-thread `codex app-server` children with the #1402 supervision rules. One generic `BridgeProviderAdapter` replaces per-provider adapter glue. Turn-start watchdog (`provider_turn_start_timeout`).
3. **Server registry + SDK** — `ProviderRegistryService` (catalog-equality pinned) and `bb.agents.experimental_registerProvider` (entry in `docs/api_to_audit.md`).
4. **First-party plugins** — `plugins/provider-{codex,claude-code,pi,acp}` take over their core-seed entries in place (position preserved, restored on disable, takeover merge preserves flagship behaviors). The app no longer depends on `@bb/agent-providers`.
5. **Third-party artifact delivery** — `bb.providerBridge` manifest key builds a self-contained bridge bundle; server stores/serves it content-addressed; daemon caches by verified hash. `HOST_DAEMON_PROTOCOL_VERSION` 123 → 124 (the PR's only bump; main took 123 for artifact engine ranges). `examples/plugins/echo-provider` proves the path end to end.

## Verification

- Full-tree typecheck 64/64; full-tree tests green except the pre-existing environmental failure in `third-party-marketplaces.test.ts` ("real checkout" git test), which fails identically on clean origin/main.
- **Live QA with real provider CLIs**, twice (pre- and post-rebase): all four providers spawn → two turns → steer/stop/resume through the canonical bridge processes, verified by process trees and event streams; flag-off runs the legacy path; final sweep shows no leaked processes. Two real bugs found and fixed with red-verified regression tests (codex construction-signature envVars mismatch; thread-scoped process leak on failed session construction).
- **Historical-bug audit**: ~30 past provider fixes classified — every invariant is either bridge-tested or lives in shared modules both paths execute; the four highest-risk shared invariants got dedicated bridge-path tests in this PR. Remaining test moves are recorded in the plan as graduation prerequisites.

## Not in this PR (deliberately)

Graduation (legacy adapter deletion after soak), calibration replay suites for pi/claude-code/codex, and the phase-6 consolidation sweep — all recorded in the plan's Remaining section. Known design item: env-var changes cannot rebuild a live bridge session (runtime never carries envVars on turns); legacy classified this as a session change.

> AGENT GENERATED: by Claude Fable 5
