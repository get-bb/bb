# WP-52 — Bench data model — runs, results, artifacts, attestations

**Lane:** L6 Bench · **Spec refs:** SPEC 05 B6–B10 · SPEC 03 §4–5 · SPEC 00 §5, §10 · RECON §2.2–2.4 · **Effort:** 2 d · **Status:** unassigned
**Depends on:** WP-04 · **Blocks:** WP-53, WP-54, WP-55, WP-58
**Produces a FROZEN artifact:** no — implements repositories over the frozen WP-04 schema

## Files you own

    plugins/bb-plugin-finite-state/lanes/bench/register.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/runs.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/results.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/artifacts.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/attestations.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/mappers.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/types.ts
    plugins/bb-plugin-finite-state/lanes/bench/store/**/*.test.ts

The registration file replaces WP-01's bench backend stub and pre-wires frozen RPC/HTTP/background services to lane-local modules. It exports command services consumed by WP-64; it never registers a second CLI.
Where WP-53–55 handlers do not exist yet, create only compiling NOT_IMPLEMENTED placeholders at their exact future-owned paths; those WPs replace them in place.

## Files you must not touch

server.ts, app.tsx, shared/contract.ts, lib/store/schema.ts, lib/context.ts, lib/remote/types.ts, test/mock-remote/fixtures/**, package.json, pnpm-lock.yaml, or another lane.

## Context

Bench runs are ACTION-ONLY to invoke and CACHED to display. The authored product model never stores a run or a result in YAML. WP-04 already froze verification_runs, verification_results, verification_artifacts, and attestations; this WP must use those exact tables even though older SPEC 05 sketches used bench_* names.

Every result is interpreted through its run, and every run binds to the firmware digest that was actually tested. An attestation subject digest must equal that run digest. A current firmware digest is never backfilled onto historical evidence.

## What to build

1. Replace the bench backend registration stub. Register all frozen bench RPCs, binary artifact/log routes, and background services once. Export lane command handlers for WP-64, which owns the single bb finite-state CLI tree; do not call bb.cli.register here. Later WPs implement imported handlers.
2. Implement repositories over the exact frozen schema. Use real SQLite transactions and typed row interfaces from lib/store/index.ts.
3. Canonicalize run tier to tier0 through tier4 and matrix column to static, emulation, hil, or manual. Mapping is tier0→static, tier1→emulation, tier2→emulation, tier3→hil, tier4→manual.
4. Canonicalize upstream async status: RUNNING maps running; COMPLETED maps completed; FAILED maps failed; TIMEOUT maps timeout. Preserve richer native verdict/status in raw without inventing extra schema states.
5. Upsert a run and its results/artifacts/attestation atomically for each coherent sync checkpoint. Partial job polling may advance run status/log cursor without deleting prior terminal evidence.
6. Results key by run, requirement ID, and check ID. Unmapped checks remain visible in the run raw/summary but cannot count as requirement proof.
7. Artifact rows store safe logical path/locator, hash, size, and kind. Never expose or trust an arbitrary upstream absolute path at an HTTP boundary.
8. Attestations store the complete envelope payload, format, subject digest, verification bit, and creation time. Verify the subject equals run.firmware_digest before marking verified.
9. Implement paged recent-run, run-detail, results, artifacts, and attestation reads. Every response reports cache freshness and uses IDs/summaries rather than unbounded raw payloads.
10. Publish bench:changed with runId/status only after a committed change.

## Interface contract

    export type BenchTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
    export type MatrixTier = "static" | "emulation" | "hil" | "manual";
    export type BenchRunStatus = "queued" | "running" | "completed" | "failed" | "timeout";

    export interface BenchRunRecord {
      runId: string;
      projectId: string;
      pvId: string | null;
      tier: BenchTier;
      matrixTier: MatrixTier;
      target: string | null;
      status: BenchRunStatus;
      firmwareDigest: string | null;
      jobId: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      raw: unknown;
    }

    export interface BenchEvidenceBundle {
      run: BenchRunRecord;
      results: Array<{
        requirementId: string;
        checkId: string;
        outcome: "pass" | "fail" | "error" | "skipped";
        evidenceSummary: string | null;
      }>;
      artifacts: Array<{ name: string; kind: string; locator: string; sha256: string | null; bytes: number | null }>;
      attestation?: { format: "in-toto" | "sigstore"; subjectDigest: string; payload: string; verified: boolean };
    }

    export function storeEvidenceCheckpoint(db: Database.Database, bundle: BenchEvidenceBundle): void;
    export function listBenchRuns(db: Database.Database, query: BenchRunQuery): Page<BenchRunSummary>;
    export function getBenchRun(db: Database.Database, runId: string): BenchRunDetail | null;

    # Frozen WP-04 relational contract; do not migrate a duplicate:
    verification_runs(run_id, project_id, pv_id, tier, matrix_col, kind, trigger,
                      host_id, thread_id, target, config, status, started_at, finished_at,
                      firmware_digest, job_id, log_locator, log_cursor, raw, synced_at)
    verification_results(result_id, run_id, project_id, pv_id, requirement_id, check_id,
                         tier, status, outcome, confidence, evidence_summary, result_data,
                         measured, failure_reason, remediation_suggestion, fs_version_id,
                         fs_version_name, is_latest, superseded_by, mapping_state, raw, pulled_at)
    verification_artifacts(artifact_id, run_id, result_id, name, kind, locator,
                           media_type, sha256, bytes, created_at, pulled_at)
    attestations(attestation_id, run_id, format, subject_digest, evidence_digest, verdict,
                 requirement_ids, check_ids, result_refs, signer_identity, rekor_uuid,
                 envelope_locator, payload, signature_verified, subject_matches_run,
                 verified, created_at, pulled_at)

RPC boundary names/shapes come from shared/contract.ts. Mappers absorb upstream shape differences; repositories do not broaden the frozen schema.

## Acceptance criteria

- [ ] Exact WP-04 tables and row types are used; no bench_* duplicate tables or migrations appear.
- [ ] Tier-to-matrix mapping is centralized and exhaustive.
- [ ] Upstream terminal states map exactly and unknown states fail closed.
- [ ] Run/results/artifacts/attestation checkpoint atomically in real SQLite.
- [ ] Verified attestation requires subject_digest equal to run firmware_digest.
- [ ] Historical evidence never adopts a newer current digest.
- [ ] Every list is paged and reports freshness.
- [ ] Artifact responses expose logical locators, never raw upstream absolute paths.
- [ ] Realtime publishes only after commit and carries a tiny refetch hint.

## Test plan

- mappers.test.ts — all tier mappings, RUNNING/COMPLETED/FAILED/TIMEOUT, unknown status error, and rich native verdict preserved in raw.
- runs.test.ts — paged ordering, same timestamp tie-break, upsert idempotency, freshness, and unknown run.
- results.test.ts — mapped/unmapped checks, outcome enum, duplicate checkpoint idempotency, and one invalid result rolls back the entire checkpoint.
- attestations.test.ts — valid subject, mismatched subject remains unverified, malformed envelope, and historical digest immutability.
- artifacts.test.ts — safe locator mapping and malicious absolute/traversal path rejected.
- Use real SQLite and verify rollback on a deliberately thrown mid-checkpoint error.

## Do not

- Do not edit the frozen schema to match older bench_run SQL.
- Do not store action invocations or evidence as YAML-authored model state.
- Do not count an unmapped check as requirement verification.
- Do not mark an attestation verified from a boolean supplied by the upstream alone; validate subject binding.
- Do not return raw artifacts, huge logs, or payload dumps through list RPCs.
- Do not register CLI commands, agent tools, mentions, or directives; WP-64/WP-60/WP-62/WP-61 own those central surfaces.

## Open questions

1. Decide whether signature verification occurs in WP-52 or a shared evidence service. The repository must still enforce subject equality and persist the independently derived `signature_verified`, `subject_matches_run`, and `verified` facts.
