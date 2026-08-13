import { afterEach, describe, expect, it } from "vitest";
import { reqIdKey } from "../../../lib/sync/registry.js";
import { createBenchTestStore, DIGEST_A, DIGEST_B, SYNCED_AT } from "../store/test-helpers.js";
import { getOtaVerdict } from "./query.js";
import { createBenchVerdictCliRunner } from "./render-cli.js";

const stores: Array<ReturnType<typeof createBenchTestStore>> = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((fixture) => fixture.host.harness.lifecycle.dispose()));
});

function requirement(id = "REQ-A", check = "CHECK-A") {
  return {
    schema: "fs-requirement/v1",
    id,
    req_type: "security",
    priority: "high",
    status: "approved",
    ears: {
      pattern: "ubiquitous",
      text: "The firmware SHALL preserve verified boot.",
      parts: { system: "firmware", response: "preserve verified boot." },
    },
    source_description: "Bench verdict fixture",
    mitigations: [],
    controls: [],
    standards: [],
    verification: [{
      check,
      method: "binary_analysis",
      tier: "static",
      required: true,
      pass_criteria: "Verified boot remains enabled.",
    }],
  };
}

function fixture(label: string) {
  const created = createBenchTestStore(`verdict-${label}`);
  stores.push(created);
  const requirementKey = reqIdKey({ reqId: "REQ-A" });
  created.db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull)
     VALUES ('project-a', 'version-a', 'requirement', 'generation-a', 7, @at)`,
  ).run({ at: SYNCED_AT });
  created.db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        remote_id, payload, content_hash, pulled_at)
     VALUES ('project-a', 'version-a', 'requirement', 'generation-a', ?,
             'remote-req-a', ?, ?, @at)`,
  ).run(requirementKey, JSON.stringify(requirement()), "c".repeat(64), { at: SYNCED_AT });
  created.db.prepare(
    `INSERT INTO verification_checks
       (project_id, project_version_id, generation_id, check_id, code, name,
        check_type, review_version, raw, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'check-a', 'CHECK-A',
             'Check A', 'binary_analysis', '1', '{}', @at)`,
  ).run({ at: SYNCED_AT });
  created.db.prepare(
    `INSERT INTO requirement_check_mappings
       (project_id, project_version_id, generation_id, requirement_key,
        check_id, is_required, suppressed, raw, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', ?, 'check-a', 1, 0, '{}', @at)`,
  ).run(requirementKey, { at: SYNCED_AT });
  created.db.prepare(
    `INSERT INTO firmware_mounts
       (project_id, project_version_id, generation_id, source, state,
        input_sha256, root_path, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'standalone_unpack',
             'ready', ?, '/logical/root', @at)`,
  ).run(DIGEST_A, { at: SYNCED_AT });
  return { ...created, requirementKey };
}

function seedProof(
  seeded: ReturnType<typeof fixture>,
  options: { digest?: string; subject?: string; verified?: boolean } = {},
) {
  const digest = options.digest ?? DIGEST_A;
  const subject = options.subject ?? digest;
  const verified = options.verified ?? true;
  seeded.db.prepare(
    `INSERT INTO verification_runs
       (project_id, project_version_id, generation_id, run_id, tier, matrix_col,
        kind, status, started_at, finished_at, firmware_digest, raw, synced_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'run-a', 'tier0', 'static',
             'bench', 'completed', '2026-08-13T10:00:00.000Z',
             '2026-08-13T10:01:00.000Z', ?, '{}', @at)`,
  ).run(digest, { at: SYNCED_AT });
  seeded.db.prepare(
    `INSERT INTO verification_results
       (project_id, project_version_id, generation_id, result_id, run_id,
        requirement_key, check_id, tier, status, outcome, executed_at,
        is_latest, mapping_state, raw, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'result-a', 'run-a', ?,
             'check-a', 'static', 'verified', 'pass',
             '2026-08-13T10:01:00.000Z', 1, 'mapped', '{}', @at)`,
  ).run(seeded.requirementKey, { at: SYNCED_AT });
  seeded.db.prepare(
    `INSERT INTO attestations
       (project_id, project_version_id, generation_id, attestation_id, run_id,
        format, subject_digest, requirement_ids, check_ids, result_refs,
        signer_identity, payload, signature_verified, subject_matches_run,
        verified, created_at, pulled_at)
     VALUES ('project-a', 'version-a', 'generation-a', 'attestation-a', 'run-a',
             'in-toto', ?, ?, '["check-a"]', '["result-a"]',
             'builder@example.test', '{}', ?, 1, ?, @at, @at)`,
  ).run(subject, JSON.stringify(["REQ-A"]), verified ? 1 : 0, verified ? 1 : 0, { at: SYNCED_AT });
}

describe("getOtaVerdict", () => {
  it("joins version-scoped results through the run digest and explicit attestation binding", async () => {
    const seeded = fixture("safe");
    seedProof(seeded);
    await expect(getOtaVerdict({ db: seeded.db, projectId: "project-a", now: () => SYNCED_AT }, "version-a"))
      .resolves.toMatchObject({
        verdict: "SAFE_TO_OTA",
        firmwareDigest: DIGEST_A,
        currentMountedDigest: DIGEST_A,
        evidence: [{
          state: "proven",
          runId: "run-a",
          checkId: "check-a",
          attestationId: "attestation-a",
          signerIdentity: "builder@example.test",
        }],
      });
  });

  it("runs the verdict CLI in project context with matching text and JSON counts", async () => {
    const seeded = fixture("cli");
    seedProof(seeded);
    const run = createBenchVerdictCliRunner(seeded.db, () => SYNCED_AT);
    const text = await run(["verdict", "version-a"], { projectId: "project-a" });
    const json = await run(["verdict", "version-a", "--json"], { projectId: "project-a" });
    expect(text).toMatchObject({ exitCode: 0, stderr: "", stdout: expect.stringContaining("Coverage: 1/1 required cells proven; 0 failed; 0 gaps") });
    expect(JSON.parse(json.stdout ?? "")).toMatchObject({ verdict: "SAFE_TO_OTA", required: 1, proven: 1, failed: 0, gaps: 0 });
  });

  it("rejects a subject-mismatched attestation as invalid signature evidence", async () => {
    const seeded = fixture("subject");
    seedProof(seeded, { subject: DIGEST_B });
    const result = await getOtaVerdict(
      { db: seeded.db, projectId: "project-a", now: () => SYNCED_AT },
      "version-a",
    );
    expect(result).toMatchObject({ verdict: "INCONCLUSIVE", evidence: [{ state: "invalid_signature" }] });
  });

  it("evaluates a requested historical digest and overlays its stale status", async () => {
    const seeded = fixture("historical");
    seedProof(seeded, { digest: DIGEST_B, subject: DIGEST_B });
    const result = await getOtaVerdict(
      { db: seeded.db, projectId: "project-a", now: () => SYNCED_AT },
      "version-a",
      DIGEST_B,
    );
    expect(result).toMatchObject({ verdict: "SAFE_TO_OTA", stale: true, firmwareDigest: DIGEST_B, currentMountedDigest: DIGEST_A });
  });

  it("returns MODEL_UNAVAILABLE for missing or corrupt requirement projections", async () => {
    const missing = createBenchTestStore("verdict-missing");
    stores.push(missing);
    const missingResult = await getOtaVerdict(
      { db: missing.db, projectId: "project-a", now: () => SYNCED_AT },
      "version-a",
    );
    expect(missingResult.verdict).toBe("INCONCLUSIVE");
    expect(missingResult.issues).toContainEqual(expect.objectContaining({ code: "MODEL_UNAVAILABLE" }));

    const corrupt = fixture("corrupt");
    corrupt.db.prepare(
      `UPDATE base_snapshot SET payload = '{broken' WHERE entity_kind = 'requirement'`,
    ).run();
    const corruptResult = await getOtaVerdict(
      { db: corrupt.db, projectId: "project-a", now: () => SYNCED_AT },
      "version-a",
    );
    expect(corruptResult.verdict).toBe("INCONCLUSIVE");
    expect(corruptResult.issues).toContainEqual(expect.objectContaining({ code: "MODEL_UNAVAILABLE" }));
  });

  it("does not leak another product version's proof into the requested scope", async () => {
    const seeded = fixture("scope");
    seedProof(seeded);
    const result = await getOtaVerdict(
      { db: seeded.db, projectId: "project-a", now: () => SYNCED_AT },
      "version-b",
    );
    expect(result).toMatchObject({ verdict: "INCONCLUSIVE", required: 0, proven: 0 });
  });
});
