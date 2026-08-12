# WP-53 — Bench tiers 0–1 execution (static + rehosted)

**Lane:** L6 Bench · **Spec refs:** SPEC 05 B7, B9–B10, X15 · SPEC 03 §4 · RECON §1.8, §2.3, §2.6–2.7 · AGENTS.md action-tool and host rules · **Effort:** 4 d · **Status:** unassigned
**Depends on:** WP-52, WP-50 · **Blocks:** WP-54, WP-55, WP-60, WP-68
**Produces a FROZEN artifact:** no — exports the ACTION-ONLY execution service later registered by WP-60

## Files you own

    plugins/bb-plugin-finite-state/lanes/bench/execute/run.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/tier0.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/tier1.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/jobs.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/hosts.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/evidence.ts
    plugins/bb-plugin-finite-state/lanes/bench/execute/**/*.test.ts

## Files you must not touch

server.ts, app.tsx, frozen contracts/store/context/remote-service files, lanes/bench/register.ts, Forge/platform source, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

Tier 0 provides fast static/binary evidence. Tier 1 runs the byte-identical fully materialized rootfs through verify_dynamic and pen_test_run. These are action invocations, not authored model edits.

Bench hosts are real bb hosts. Enrollment uses bb.sdk.hosts.createJoinCode; bb.hosts only manages tunnels. The target must run host-daemon and redeem the code. A run thread is server-initiated onto that daemon; an arbitrary external process cannot be attached after the fact.

Forge jobs return job_id and are polled through get_job_status. Terminal states are COMPLETED, FAILED, or TIMEOUT. Tier 1 also requires FORGE_ALLOW_PENTEST=1, Docker for verify_dynamic, the cve-evidence-verifier binary for pen_test_run, and the strict deployment_context fields.

## What to build

1. Implement a runBench service for tier0 and tier1 only. Validate project/version, optional requirement, target path, host, and deployment context. Reject tier2–tier4 with TIER_NOT_IMPLEMENTED rather than silently mapping them.
2. Enroll hosts through a human-facing RPC that calls bb.sdk.hosts.createJoinCode. Return joinCode, hostId, and expiresAt once. UI copy instructs the target to run host-daemon and redeem it. Never use bb.hosts as enrollment.
3. List/select enrolled hosts through bb.sdk.hosts. Preflight required tools/capabilities on the target and report concrete missing prerequisites.
4. Create the verification run row as queued with the firmware digest that will be tested. For Tier 1, obtain PreparedFirmware only through WP-50 and revalidate it immediately before dispatch.
5. Start a bb thread on the selected host from the server side. Pass the prepared firmware environment before the target Forge process starts. Store the returned thread and selected host in the frozen `verification_runs.thread_id`/`host_id` columns; never hide this navigation identity in raw JSON.
6. Tier 0 runs configured static/SBOM/binary checks through direct Platform data and declared local/host analyzers. It does not require Forge. Map checks to requirement IDs before they can affect the matrix. Missing mappings remain visible as unmapped evidence.
7. Tier 1 requires configured `ForgeComputeClient` and calls only `verifyDynamic` and `penTestRun` against the prepared root. Construct all required deployment context fields explicitly. Do not dispatch when compute or its prerequisites are unavailable.
8. Poll jobs with cancellable backoff. Handle only RUNNING plus COMPLETED/FAILED/TIMEOUT. Publish bench:changed and bench:log hints; details are refetched from cache.
9. Convert job results into a WP-52 evidence checkpoint. Bind every result/artifact/attestation to the prepared digest. Preserve job events and log paths server-side; expose paged/logical access only.
10. Accept signed evidence only when cryptographic verification succeeds and the attestation subject equals the prepared digest. If signing is unavailable, store the run as unsigned; it must not become SAFE in WP-55.
11. Write back to AS verification results only through a frozen, handler-verified `AssuranceStudioClient` method. If absent, keep local evidence current and file the AS method amendment; there is no raw fallback.
12. Export runBench for WP-60's fs_bench_run tool registration. This WP does not register a fourth action tool or a push capability.

## Interface contract

    export interface BenchRunRequest {
      projectId: string;
      pvId: string;
      tier: "tier0" | "tier1";
      hostId: string;
      requirementId?: string;
      target?: string;
      deploymentContext?: {
        productType: string;
        networkExposure: string;
        regulatory: string;
        deploymentNotes: string;
        rootComponentName: string;
        rootComponentType: string;
      };
    }

    export interface BenchRunStarted {
      runId: string;
      threadId: string;
      jobIds: string[];
      firmwareDigest: string;
      status: "queued" | "running";
    }

    export interface HostEnrollment {
      joinCode: string;
      hostId: string;
      expiresAt: string;
    }

    export function createBenchHostJoinCode(bb: BbPluginApi): Promise<HostEnrollment>;
    export function runBench(deps: BenchExecutionDeps, request: BenchRunRequest, signal: AbortSignal): Promise<BenchRunStarted>;

    export type ForgeJobTerminal = "COMPLETED" | "FAILED" | "TIMEOUT";

The agent-facing tool schema in WP-60 is narrower and delegates to runBench. Human host enrollment is not an agent tool.

## Acceptance criteria

- [ ] Host enrollment calls bb.sdk.hosts.createJoinCode and requires target host-daemon.
- [ ] Threads are server-initiated on an enrolled host and capture thread/host linkage.
- [ ] Tier 1 cannot dispatch without WP-50 fully materialized, revalidated bytes.
- [ ] verify_dynamic and pen_test_run prerequisites and strict deployment context are checked before invocation.
- [ ] Job polling recognizes exact terminal states and persists a coherent evidence checkpoint.
- [ ] Results and attestations bind to the prepared firmware digest.
- [ ] Unsigned or subject-mismatched evidence remains visibly unverified.
- [ ] Tier 0/1 unmapped checks cannot satisfy requirements.
- [ ] Tier 2–4 requests fail explicitly.
- [ ] No sync push or additional server-touching agent capability is introduced.

## Test plan

- hosts.test.ts — createJoinCode result/expiry, target not enrolled, wrong host capability, and prove bb.hosts enrollment methods are never called.
- tier0.test.ts — mapped static pass/fail, unmapped check, partial analyzer result, and analyzer error becomes evidence error rather than pass.
- tier1.test.ts — prepared-root environment, strict deployment context, verify_dynamic plus pen_test_run, missing Docker/verifier/FORGE_ALLOW_PENTEST, and no dispatch on incomplete mount.
- jobs.test.ts — RUNNING→COMPLETED, FAILED, TIMEOUT, cancellation, unknown terminal state, and result only read from terminal status response.
- Fault injection — connection reset during polling resumes by job_id; a firmware mutation before dispatch yields zero Forge action calls.
- evidence.test.ts — valid signed subject, subject mismatch, unsigned result, and transactional checkpoint rollback.

## Do not

- Do not enroll through bb.hosts, attach an existing process as a thread, or run on an unenrolled machine.
- Do not dispatch Tier 1 against lazy/API placeholders or a digest computed after the run.
- Do not infer pass from a successful process exit when checks/results say fail/error.
- Do not mark unsigned evidence verified or fabricate a Rekor/signing record.
- Do not implement tiers 2–4 in this WP.
- Do not register agent tools here.

## Open questions

1. The exact SDK thread-start signature and host binding must be taken from the merged bb SDK/frozen helper; RECON establishes the direction but this spec does not invent parameter names.
2. Upstream verification writeback needs a verified client contract. Local evidence remains authoritative for the plugin view until that exists.
3. Decide the minimum Tier-0 check set from direct Platform capabilities and installed host analyzers; do not make Tier 0 depend on Forge.
