import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { listBenchArtifacts } from "./artifacts.js";
import { listBenchAttestations } from "./attestations.js";
import {
  listBenchResults,
  storeEvidenceCheckpointWithResult,
} from "./results.js";
import {
  ensureAcceptedBenchGeneration,
  getBenchRun,
  listBenchRuns,
} from "./runs.js";
import {
  createBenchTestStore,
  DIGEST_A,
  evidenceBundle,
  SYNCED_AT,
} from "./test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("bench runs repository", () => {
  it("orders newest first with a deterministic same-time run-id tie break and pages", () => {
    const fixture = createBenchTestStore("runs-page");
    hosts.push(fixture.host);
    for (const runId of ["run-a", "run-c", "run-b"]) {
      storeEvidenceCheckpointWithResult(
        fixture.db,
        evidenceBundle({ run: { ...evidenceBundle().run, runId } }),
        SYNCED_AT,
      );
    }
    const first = listBenchRuns(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      pageSize: 2,
      continuation: null,
      now: "2026-08-12T20:01:00.000Z",
    });
    expect(first.items.map((run) => run.runId)).toEqual(["run-c", "run-b"]);
    expect(first.total).toBe(3);
    expect(first.next).not.toBeNull();
    expect(first.cache).toMatchObject({ state: "fresh", baseRevision: 7 });
    const second = listBenchRuns(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      pageSize: 2,
      continuation: first.next,
      now: "2026-08-12T20:01:00.000Z",
    });
    expect(second.items.map((run) => run.runId)).toEqual(["run-a"]);
    expect(second.next).toBeNull();
  });

  it("is idempotent and reports unknown runs without leaking another scope", () => {
    const fixture = createBenchTestStore("runs-idempotent");
    hosts.push(fixture.host);
    expect(
      storeEvidenceCheckpointWithResult(fixture.db, evidenceBundle(), SYNCED_AT)
        .changed,
    ).toBe(true);
    expect(
      storeEvidenceCheckpointWithResult(fixture.db, evidenceBundle(), SYNCED_AT)
        .changed,
    ).toBe(false);
    expect(
      getBenchRun(fixture.db, {
        projectId: "project-a",
        pvId: "version-a",
        runId: "missing",
      }),
    ).toBeNull();
  });

  it("allows polling to advance status and log cursor without deleting evidence", () => {
    const fixture = createBenchTestStore("runs-poll");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        run: {
          ...evidenceBundle().run,
          status: "running",
          finishedAt: null,
          logLocator: "runs/run-a/log.ndjson",
          logCursor: "10",
        },
        artifacts: [
          {
            name: "report",
            kind: "json",
            locator: "runs/run-a/report.json",
            sha256: null,
            bytes: 2,
          },
        ],
      }),
      SYNCED_AT,
    );
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        run: { ...evidenceBundle().run, status: "completed", logCursor: "20" },
      }),
      "2026-08-12T20:02:00.000Z",
    );
    expect(
      fixture.db
        .prepare("SELECT COUNT(*) FROM verification_artifacts")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      fixture.db
        .prepare(
          "SELECT status, log_locator, log_cursor FROM verification_runs",
        )
        .get(),
    ).toEqual({
      status: "completed",
      log_locator: "runs/run-a/log.ndjson",
      log_cursor: "20",
    });
  });

  it("ignores a newer generation accepted for another kind when filing evidence", () => {
    const fixture = createBenchTestStore("runs-cross-kind");
    hosts.push(fixture.host);
    fixture.db
      .prepare(
        `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES ('project-a', 'version-a', 'generation-finding', 'accepted',
                 '["finding"]', @at, @at, @at)`,
      )
      .run({ at: "2026-08-12T20:10:00.000Z" });
    fixture.db
      .prepare(
        `INSERT INTO sync_state
           (project_id, project_version_id, entity_kind, accepted_generation_id,
            base_revision, last_pull)
         VALUES ('project-a', 'version-a', 'finding', 'generation-finding', 99, @at)`,
      )
      .run({ at: "2026-08-12T20:10:00.000Z" });

    storeEvidenceCheckpointWithResult(fixture.db, evidenceBundle(), SYNCED_AT);

    expect(
      fixture.db
        .prepare("SELECT generation_id FROM verification_runs")
        .pluck()
        .get(),
    ).toBe("generation-a");
  });

  it("reads only the accepted verificationRun generation and reports its revision", () => {
    const fixture = createBenchTestStore("runs-generation-drift");
    hosts.push(fixture.host);
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({
        run: { ...evidenceBundle().run, runId: "run-old" },
        results: [
          {
            requirementId: "REQ-OLD",
            checkId: "check-old",
            outcome: "pass",
            evidenceSummary: "superseded evidence",
          },
        ],
        artifacts: [
          {
            name: "old.json",
            kind: "report",
            locator: "runs/run-old/old.json",
            sha256: null,
            bytes: 2,
          },
        ],
        attestation: {
          format: "in-toto",
          subjectDigest: DIGEST_A,
          payload: JSON.stringify({
            payloadType: "application/vnd.in-toto+json",
          }),
          verified: true,
        },
      }),
      SYNCED_AT,
    );
    fixture.db
      .prepare(
        `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES ('project-a', 'version-a', 'generation-b', 'accepted',
                 '["verificationRun","verificationResult"]', @at, @at, @at)`,
      )
      .run({ at: "2026-08-12T20:10:00.000Z" });
    fixture.db
      .prepare(
        `UPDATE pull_generation SET status = 'superseded'
         WHERE project_id = 'project-a' AND project_version_id = 'version-a'
           AND generation_id = 'generation-a'`,
      )
      .run();
    fixture.db
      .prepare(
        `UPDATE sync_state
         SET accepted_generation_id = 'generation-b', base_revision = 9,
             last_pull = @at
         WHERE project_id = 'project-a' AND project_version_id = 'version-a'
           AND entity_kind = 'verificationRun'`,
      )
      .run({ at: "2026-08-12T20:10:00.000Z" });
    storeEvidenceCheckpointWithResult(
      fixture.db,
      evidenceBundle({ run: { ...evidenceBundle().run, runId: "run-new" } }),
      "2026-08-12T20:11:00.000Z",
    );

    const page = listBenchRuns(fixture.db, {
      projectId: "project-a",
      pvId: "version-a",
      pageSize: 20,
      continuation: null,
      now: "2026-08-12T20:12:00.000Z",
    });
    expect(page.items.map((run) => run.runId)).toEqual(["run-new"]);
    expect(page.total).toBe(1);
    expect(page.cache).toMatchObject({
      state: "fresh",
      acceptedGenerationId: "generation-b",
      baseRevision: 9,
    });
    expect(
      getBenchRun(fixture.db, {
        projectId: "project-a",
        pvId: "version-a",
        runId: "run-old",
      }),
    ).toBeNull();
    const oldPageQuery = {
      projectId: "project-a",
      pvId: "version-a",
      runId: "run-old",
      pageSize: 20,
      continuation: null,
    } as const;
    expect(listBenchResults(fixture.db, oldPageQuery).items).toEqual([]);
    expect(listBenchArtifacts(fixture.db, oldPageQuery).items).toEqual([]);
    expect(listBenchAttestations(fixture.db, oldPageQuery).items).toEqual([]);
  });

  it("fails closed when no verificationRun generation is accepted", () => {
    const fixture = createBenchTestStore("runs-no-generation");
    hosts.push(fixture.host);
    fixture.db
      .prepare(
        `UPDATE sync_state SET accepted_generation_id = NULL
         WHERE project_id = 'project-a' AND project_version_id = 'version-a'
           AND entity_kind = 'verificationRun'`,
      )
      .run();
    expect(() =>
      listBenchRuns(fixture.db, {
        projectId: "project-a",
        pvId: "version-a",
        pageSize: 20,
        continuation: null,
      }),
    ).toThrow(/accepted verificationRun generation/iu);
    expect(() =>
      storeEvidenceCheckpointWithResult(
        fixture.db,
        evidenceBundle(),
        SYNCED_AT,
      ),
    ).toThrow(/accepted verificationRun generation/iu);
    expect(
      fixture.db
        .prepare("SELECT COUNT(*) FROM verification_runs")
        .pluck()
        .get(),
    ).toBe(0);
  });

  it("reports requirement-only versions as empty and opens deterministic local evidence provenance", () => {
    const fixture = createBenchTestStore("runs-requirement-only");
    hosts.push(fixture.host);
    fixture.db
      .prepare(
        `UPDATE sync_state SET accepted_generation_id = NULL
          WHERE project_id = 'project-a' AND project_version_id = 'version-a'
            AND entity_kind = 'verificationRun'`,
      )
      .run();
    fixture.db
      .prepare(
        `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES ('project-a', 'version-a', 'generation-requirement', 'accepted',
                 '["requirement"]', @at, @at, @at)`,
      )
      .run({ at: SYNCED_AT });
    fixture.db
      .prepare(
        `INSERT INTO sync_state
           (project_id, project_version_id, entity_kind,
            accepted_generation_id, base_revision, last_pull)
         VALUES ('project-a', 'version-a', 'requirement',
                 'generation-requirement', 3, @at)`,
      )
      .run({ at: SYNCED_AT });

    expect(
      listBenchRuns(fixture.db, {
        projectId: "project-a",
        pvId: "version-a",
        pageSize: 20,
        continuation: null,
      }),
    ).toMatchObject({
      items: [],
      total: 0,
      cache: { state: "empty", acceptedGenerationId: null, baseRevision: 3 },
    });
    expect(
      ensureAcceptedBenchGeneration(
        fixture.db,
        "project-a",
        "version-a",
        () => "deterministic-generation",
        "2026-08-12T20:05:00.000Z",
      ),
    ).toEqual({
      generation_id: "bench-evidence-deterministic-generation",
      base_revision: 8,
    });
    expect(
      fixture.db
        .prepare(
          `SELECT requested_kinds_json FROM pull_generation
            WHERE generation_id = 'bench-evidence-deterministic-generation'`,
        )
        .get(),
    ).toEqual({
      requested_kinds_json:
        '{"source":"local_bench_evidence","kinds":["verificationRun"]}',
    });
  });
});
