import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { listBenchResults, storeEvidenceCheckpointWithResult } from "./results.js";
import {
  createBenchTestStore,
  evidenceBundle,
  seedMappedCheck,
  SYNCED_AT,
} from "./test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

interface LatestResultRow {
  result_id: string;
  run_id: string;
  outcome: string;
  is_latest: number;
  superseded_by: string | null;
}

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("bench results repository", () => {
  it("keeps mapped and unmapped checks visible but proof columns fail closed", () => {
    const fixture = createBenchTestStore("results-mapping");
    hosts.push(fixture.host);
    seedMappedCheck(fixture.db);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        results: [
          { requirementId: "REQ-A", checkId: "check-a", outcome: "pass", evidenceSummary: "ok" },
          {
            requirementId: "REQ-UNMAPPED",
            checkId: "unknown-check",
            outcome: "fail",
            evidenceSummary: "visible failure",
          },
        ],
      }),
      SYNCED_AT,
    );
    const page = listBenchResults(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-a",
      pageSize: 20,
      continuation: null,
    });
    expect(page.items).toHaveLength(2);
    expect(page.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirementId: "REQ-A",
          checkId: "check-a",
          mapped: true,
          outcome: "pass",
        }),
        expect.objectContaining({
          requirementId: null,
          checkId: null,
          reportedRequirementId: "REQ-UNMAPPED",
          reportedCheckId: "unknown-check",
          mapped: false,
          outcome: "fail",
        }),
      ]),
    );
  });

  it("makes duplicate checkpoints idempotent", () => {
    const fixture = createBenchTestStore("results-idempotent");
    hosts.push(fixture.host);
    seedMappedCheck(fixture.db);
    const bundle = evidenceBundle({
      results: [
        { requirementId: "REQ-A", checkId: "check-a", outcome: "pass", evidenceSummary: null },
      ],
    });
    expect(storeEvidenceCheckpointWithResult(fixture.db, bundle, SYNCED_AT).changed).toBe(true);
    expect(storeEvidenceCheckpointWithResult(fixture.db, bundle, SYNCED_AT).changed).toBe(false);
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_results").pluck().get()).toBe(1);
  });

  it("atomically supersedes the prior latest result without self-superseding replay", () => {
    const fixture = createBenchTestStore("results-latest");
    hosts.push(fixture.host);
    seedMappedCheck(fixture.db);
    const result = (outcome: "pass" | "fail") => ({
      requirementId: "REQ-A",
      checkId: "check-a",
      outcome,
      evidenceSummary: null,
    });
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        run: { ...evidenceBundle().run, runId: "run-pass" },
        results: [result("pass")],
      }),
      SYNCED_AT,
    );
    const failingBundle = evidenceBundle({
      run: { ...evidenceBundle().run, runId: "run-fail" },
      results: [result("fail")],
    });
    storeEvidenceCheckpointWithResult(fixture.db, failingBundle, SYNCED_AT);

    const rows = fixture.db
      .prepare<[], LatestResultRow>(
        `SELECT result_id, run_id, outcome, is_latest, superseded_by
         FROM verification_results ORDER BY run_id`,
      )
      .all();
    const failing = rows.find((row) => row.run_id === "run-fail");
    const passing = rows.find((row) => row.run_id === "run-pass");
    expect(failing).toMatchObject({ outcome: "fail", is_latest: 1, superseded_by: null });
    expect(passing).toMatchObject({
      outcome: "pass",
      is_latest: 0,
      superseded_by: failing?.result_id,
    });

    expect(storeEvidenceCheckpointWithResult(fixture.db, failingBundle, SYNCED_AT).changed).toBe(
      false,
    );
    expect(
      fixture.db
        .prepare(
          `SELECT is_latest, superseded_by FROM verification_results
           WHERE run_id = 'run-fail'`,
        )
        .get(),
    ).toEqual({ is_latest: 1, superseded_by: null });
  });

  it("rolls back the entire checkpoint when one result is invalid", () => {
    const fixture = createBenchTestStore("results-rollback");
    hosts.push(fixture.host);
    seedMappedCheck(fixture.db);
    expect(() =>
      storeEvidenceCheckpointWithResult(
        fixture.db,
        evidenceBundle({
          results: [
            { requirementId: "REQ-A", checkId: "check-a", outcome: "pass", evidenceSummary: null },
            {
              requirementId: "REQ-A",
              checkId: "check-a",
              outcome: "error",
              evidenceSummary: "x".repeat(20_001),
            },
          ],
        }),
        SYNCED_AT,
      ),
    ).toThrow(/too large/iu);
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_runs").pluck().get()).toBe(0);
    expect(fixture.db.prepare("SELECT COUNT(*) FROM verification_results").pluck().get()).toBe(0);
  });
});
