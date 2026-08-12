# WP-60 — Action tools & the allowlist guard

**Lane:** L7 Agentic surfaces · **Spec:** SPEC 03 §6.2 · SPEC 05 X14.1 · SPEC 06 §5.3–5.4 · RECON §1.5, §2.3 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-57, WP-40, WP-49, WP-50, WP-53 · **Blocks:** WP-63, WP-65
**Produces a FROZEN artifact:** no — adding an action requires `AMENDMENTS.md` and a registry-contract change

## Files you own
```
plugins/bb-plugin-finite-state/lanes/agentic/tools/actions.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/action-schemas.ts
plugins/bb-plugin-finite-state/lib/agentic/action-allowlist.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/actions.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/action-allowlist.test.ts
plugins/bb-plugin-finite-state/lanes/agentic/tools/actions.integration.test.ts
```

## Files you must not touch
Composition roots, frozen interfaces, run/materialization implementations owned by L4/L6, read/write tools, skills, CLI, dependencies, or mock fixtures.

## Context
Exactly three agent tools may cause server-side work: verification, bench, and firmware byte materialization. They invoke analysis or fetch bytes; they do not mutate the authored model. bb has no plugin-configurable per-tool approval field. The reliable gate is architectural: no other registered tool receives an action service, remote-client aggregate, generic request, or push capability.

## What to build
1. Encode a literal allowlist containing only `fs_verification_run`, `fs_bench_run`, and `fs_firmware_materialize`.
2. Register those tools with strict schemas and delegate to narrow owner services, never `RemoteServices`, a generic request, or a generic compute client.
3. `fs_verification_run` resolves a requirement/check/tier, invokes the sanctioned run, returns the job id immediately, and publishes progress as refetch hints. Status changes only from returned evidence.
4. `fs_bench_run` verifies the selected firmware digest and full-materialization precondition before dispatch. Return `{run_id,thread_id,status}`. On timeout/ambiguity, the hint says to query status; never auto-dispatch a duplicate.
5. `fs_firmware_materialize` supports manifest, hydrate, and hydrate_all. Direct Platform byte fetch respects admin permission and the range/full streaming contract through the firmware owner. Local standalone unpack remains the offline/non-admin whole-image fallback.
6. Log action name, actor/thread context, sanitized parameters, start/result ids, and outcome. Never log firmware bytes, tokens, document bodies, or secrets.
7. Add static module-graph/registry assertions: non-action tools cannot import action services or remote action/write modules; the allowlist equals the set of registry actions; a fourth entry fails absent a recorded amendment.
8. Add a context-aware negative assertion across agent registrations, skill tool sections, and the registry that `fs_sync_push` is never registered, invocable, or advertised. A prohibition in a skill's `Never` section may name the forbidden identifier.

## Interface contract
```ts
export const ACTION_TOOL_ALLOWLIST = [
  "fs_verification_run",
  "fs_bench_run",
  "fs_firmware_materialize",
] as const;
export type ActionToolName = typeof ACTION_TOOL_ALLOWLIST[number];

export interface VerificationAction {
  run(input: { requirement: string; tier?: string; check?: string }): Promise<{ jobId: string; runId?: string }>;
}
export interface BenchAction {
  run(input: { pvId: string; tier: string; requirement?: string; target?: string }): Promise<{
    runId: string; threadId: string; status: "queued" | "running";
  }>;
}
export interface FirmwareAction {
  materialize(input: {
    pvId: string; scanId?: string; mode: "manifest" | "hydrate" | "hydrate_all"; paths?: string[];
  }): Promise<{ pvId: string; source: "standalone_unpack" | "api"; hydrated: number; remaining: number; errors: number }>;
}

export function registerActionTools(bb: BbPluginApi, ctx: PluginContext): void;
export function assertActionBoundary(registry: typeof AGENT_SURFACE): void;
```

## Acceptance criteria
- [ ] The runtime and compile-time action sets contain exactly the same three names.
- [ ] No generic remote/raw-API client is reachable from tool parameters or non-action handlers.
- [ ] Verification and bench invocations return durable ids before polling and never fabricate success.
- [ ] Bench dispatch refuses a digest mismatch or incomplete mount before invoking Forge.
- [ ] Firmware whole-image guidance leads with standalone unpack; API byte fallback surfaces admin failures honestly.
- [ ] Action ambiguity returns a status-query recovery hint and never retries non-idempotent dispatch automatically.
- [ ] Logs are audit-useful and secret/binary safe.
- [ ] CI fails when a fourth action or any push tool is registered without amendment.

## Test plan
`action-allowlist.test.ts`
- `allowlist equals registry action set`.
- `adding a fourth action fails with amendment-required message` (**safety error path**).
- `non-action module graph cannot reach remote action/write modules`.
- `fs_sync_push is absent from registrations and advertised capability lists`; negative prohibition prose is allowed.

`actions.test.ts`
- one strict-schema and delegation test per tool.
- `bench refuses incomplete materialization` (**precondition path**).
- `verification timeout tells caller to query status and does not retry`.
- `firmware API 403 returns metadata-only/admin hint` (**Platform fault path**).

`actions.integration.test.ts`
- execute each action through `harness.callAgentTool`, assert audit log and realtime hint.
- inject duplicate-dispatch ambiguity and assert one owner-service call.
- assert model/YAML state is unchanged by each invocation except cache/run evidence written by its owner.

## Do not
- Do not add `requiresApproval`, `confirm`, or invented SDK fields.
- Do not add a generic action, raw remote/compute call, push, conflict resolver, attestation writer, or HBOM acceptor.
- Do not treat a queued job as passed evidence.
- Do not retry a non-idempotent run after an ambiguous response.
- Do not silently fall back from exact firmware bytes to a different scan or digest.

## Open questions
1. Confirm whether the product wants an explicit `pendingInteraction` before action execution in the panel/CLI. That human UX is separate from agent-tool authorization and cannot weaken this allowlist.
2. If firmware `manifest` mode is entirely local by WP-48, keep it under the same canonical tool but record `serverAccess:none` in invocation telemetry for that call.
