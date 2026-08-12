import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { openStore } from "../../../lib/store/index.js";
import type { BenchEvidenceBundle } from "./types.js";

export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const SYNCED_AT = "2026-08-12T20:00:00.000Z";

export function createBenchTestStore(tag: string) {
  const host = createFakePluginHost({ pluginId: `finite-state-bench-${tag}` });
  const store = openStore(host.bb);
  store.db
    .prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'accepted',
               '["verificationRun","verificationResult"]', @at, @at, @at)`,
    )
    .run({ at: SYNCED_AT });
  store.db
    .prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('project-a', 'version-a', 'verificationRun', 'generation-a', 7, @at)`,
    )
    .run({ at: SYNCED_AT });
  return { host, db: store.db };
}

export function seedMappedCheck(db: ReturnType<typeof createBenchTestStore>["db"]): void {
  db.prepare(
    `INSERT INTO verification_checks
       (project_id, project_version_id, generation_id, check_id, code, name,
        check_type, review_version, raw, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'check-a', 'CHECK-A',
             'Check A', 'static', '1', '{}', @at)`,
  ).run({ at: SYNCED_AT });
  db.prepare(
    `INSERT INTO requirement_check_mappings
       (project_id, project_version_id, generation_id, requirement_key,
        check_id, is_required, suppressed, raw, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'REQ-A', 'check-a',
             1, 0, '{}', @at)`,
  ).run({ at: SYNCED_AT });
}

export function evidenceBundle(
  overrides: Partial<BenchEvidenceBundle> = {},
): BenchEvidenceBundle {
  return {
    run: {
      runId: "run-a",
      projectId: "project-a",
      pvId: "version-a",
      tier: "tier0",
      matrixTier: "static",
      target: null,
      status: "completed",
      firmwareDigest: DIGEST_A,
      jobId: "job-a",
      startedAt: "2026-08-12T19:59:00.000Z",
      finishedAt: SYNCED_AT,
      raw: { nativeVerdict: "PASS_WITH_WARNINGS" },
    },
    results: [],
    artifacts: [],
    ...overrides,
  };
}
