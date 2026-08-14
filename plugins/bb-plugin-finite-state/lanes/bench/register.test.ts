import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { registerRemoteServices } from "../remote/register.js";
import { createBenchCommandServices, registerBench } from "./register.js";
import { createBenchTestStore, evidenceBundle } from "./store/test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

function requiredNestedString(
  value: unknown,
  path: readonly (string | number)[],
): string {
  let current = value;
  for (const part of path) {
    if (typeof part === "number") {
      if (!Array.isArray(current))
        throw new Error(`Expected array at ${String(part)}`);
      current = current[part];
    } else {
      if (typeof current !== "object" || current === null)
        throw new Error(`Expected object at ${part}`);
      current = Reflect.get(current, part);
    }
  }
  if (typeof current !== "string")
    throw new Error(`Expected string at ${path.join(".")}`);
  return current;
}

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("bench registration", () => {
  it("registers frozen RPCs, bounded stream seams, and one job service without a CLI", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bench-registration",
      sdk: {
        hosts: {
          list: async () => [
            {
              id: "host-a",
              name: "Bench A",
              type: "persistent",
              status: "connected",
              maxPermissionMode: "full",
              lastSeenAt: 1_000,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        projects: {
          get: async () => ({
            id: "project-a",
            kind: "standard",
            name: "Project A",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [
              {
                id: "source-a",
                projectId: "project-a",
                type: "local_path",
                hostId: "host-a",
                path: "/workspace/project-a",
                isDefault: true,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        },
        threads: { spawn: async () => ({ id: "thread-bench-a" }) },
      },
    });
    hosts.push(host);
    const context = createPluginContext(host.bb);
    await registerRemoteServices(host.bb, context);
    registerBench(host.bb, context);
    await expect(
      host.harness.behavior.callRpc("benchRunsList", {
        projectId: "project-a",
        projectVersionId: null,
      }),
    ).resolves.toMatchObject({
      items: [],
      total: 0,
      next: null,
      cache: { state: "empty", acceptedGenerationId: null },
    });
    context.db().exec(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'accepted',
               '["verificationRun"]', '2026-08-12T20:00:00.000Z',
               '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z');
       INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('project-a', 'version-a', 'verificationRun', 'generation-a', 1,
               '2026-08-12T20:00:00.000Z');
       INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('project-a', 'findings-only', 'generation-findings', 'accepted',
               '["finding"]', '2026-08-12T20:00:01.000Z',
               '2026-08-12T20:00:01.000Z', '2026-08-12T20:00:01.000Z'),
              ('project-foreign', 'foreign-version', 'generation-foreign', 'accepted',
               '["verificationRun"]', '2026-08-12T20:00:02.000Z',
               '2026-08-12T20:00:02.000Z', '2026-08-12T20:00:02.000Z');
       INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('project-a', 'findings-only', 'finding', 'generation-findings', 1,
               '2026-08-12T20:00:01.000Z'),
              ('project-foreign', 'foreign-version', 'verificationRun',
               'generation-foreign', 1, '2026-08-12T20:00:02.000Z');
       INSERT INTO workspace_platform_project_binding
         (workspace_project_id, platform_project_id)
       VALUES ('workspace-project-a', 'project-a'),
              ('workspace-project-foreign', 'project-foreign');
       INSERT INTO firmware_mounts
         (project_id, project_version_id, generation_id, source, state,
          input_sha256, artifact_hash, root_path, file_count,
          materialized_files, error_count, pulled_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'standalone_unpack',
               'metadata_only', '${"a".repeat(64)}', NULL, '/logical/root', 0,
               0, 0, '2026-08-12T20:00:00.000Z');`,
    );

    const page = await host.harness.behavior.callRpc("benchRunsList", {
      projectId: "project-a",
      projectVersionId: "version-a",
      pageSize: 20,
      continuation: null,
    });
    expect(page).toMatchObject({ items: [], total: 0, next: null });
    await expect(
      host.harness.behavior.callRpc("benchProjectVersions", {
        projectId: "workspace-project-a",
      }),
    ).resolves.toEqual({
      versions: [
        {
          workspaceProjectId: "workspace-project-a",
          platformProjectId: "project-a",
          projectVersionId: "version-a",
          asOf: "2026-08-12T20:00:00.000Z",
          state: "fresh",
        },
      ],
      selectedPlatformProjectId: "project-a",
      selectedProjectVersionId: "version-a",
    });
    await expect(
      host.harness.behavior.callRpc("benchOtaVerdictGet", {
        projectId: "project-a",
        pvId: "version-a",
        digest: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      pvId: "version-a",
      verdict: "INCONCLUSIVE",
      firmwareDigest: "a".repeat(64),
      issues: [{ code: "MODEL_UNAVAILABLE" }],
    });
    await expect(
      host.harness.behavior.callRpc("benchRunStart", {
        projectId: "project-a",
        projectVersionId: "version-a",
        tier: "tier0",
        hostId: "host-a",
      }),
    ).resolves.toMatchObject({
      projectId: "project-a",
      projectVersionId: "version-a",
      threadId: "thread-bench-a",
      jobIds: [],
      firmwareSha256: "a".repeat(64),
      status: "running",
    });
    const startedPage = await host.harness.behavior.callRpc("benchRunsList", {
      projectId: "project-a",
      projectVersionId: "version-a",
      pageSize: 20,
      continuation: null,
    });
    expect(startedPage).toMatchObject({
      items: [
        {
          fields: {
            kind: "bench",
            threadId: "thread-bench-a",
            hostId: "host-a",
            config: null,
            durationMs: null,
            logAvailable: false,
            logCursor: null,
          },
        },
      ],
    });
    const runId = requiredNestedString(startedPage, ["items", 0, "key"]);
    const locallyResolvedPage = await host.harness.behavior.callRpc(
      "benchRunsList",
      {
        projectId: "project-a",
        projectVersionId: null,
      },
    );
    expect(locallyResolvedPage).toMatchObject({
      items: [{ key: runId, projectVersionId: "version-a" }],
      total: 1,
    });
    await expect(
      host.harness.behavior.callRpc("benchRunGet", {
        projectId: "project-a",
        projectVersionId: null,
        runId,
      }),
    ).resolves.toMatchObject({ key: runId, projectVersionId: "version-a" });
    context
      .db()
      .prepare(
        `UPDATE verification_runs
       SET raw = ?, log_cursor = 'forge-cursor-a'
       WHERE run_id = ?`,
      )
      .run(
        JSON.stringify({ jobs: [{ logTail: ["one", "two", "three"] }] }),
        runId,
      );
    context
      .db()
      .prepare(
        `INSERT INTO attestations
         (project_id, project_version_id, generation_id, attestation_id, run_id,
          format, subject_digest, payload, signature_verified,
          subject_matches_run, verified, created_at, pulled_at)
       VALUES ('project-a', 'version-a', 'generation-a', 'attestation-a', ?,
               'in-toto', ?, ?, 1, 1, 1,
               '2026-08-12T20:00:01.000Z', '2026-08-12T20:00:01.000Z')`,
      )
      .run(
        runId,
        `sha256:${"a".repeat(64)}`,
        JSON.stringify({ project: "project-a" }),
      );
    context.db().exec(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('project-b', 'version-b', 'generation-b', 'accepted',
               '["verificationRun"]', '2026-08-12T20:00:00.000Z',
               '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z');
       INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('project-b', 'version-b', 'verificationRun', 'generation-b', 1,
               '2026-08-12T20:00:00.000Z');
       INSERT INTO verification_runs
         (project_id, project_version_id, generation_id, run_id, tier,
          matrix_col, kind, status, raw, synced_at)
       VALUES ('project-b', 'version-b', 'generation-b', 'run-foreign', 'tier0',
               'static', 'bench', 'completed',
               '{"jobs":[{"logTail":["foreign secret"]}]}',
               '2026-08-12T20:00:01.000Z');
       INSERT INTO attestations
         (project_id, project_version_id, generation_id, attestation_id, run_id,
          format, subject_digest, payload, signature_verified,
          subject_matches_run, verified, created_at, pulled_at)
       VALUES ('project-b', 'version-b', 'generation-b', 'attestation-b',
               'run-foreign', 'in-toto', 'sha256:${"b".repeat(64)}',
               '{"project":"project-b"}', 1, 1, 1,
               '2026-08-12T20:00:01.000Z', '2026-08-12T20:00:01.000Z');`,
    );
    const firstLogPage = await host.harness.behavior.callRpc("benchLogsList", {
      projectId: "project-a",
      projectVersionId: "version-a",
      runId,
      pageSize: 2,
      continuation: null,
    });
    expect(firstLogPage).toMatchObject({
      items: [
        { sequence: 0, level: "stdout", text: "one" },
        { sequence: 1, level: "stdout", text: "two" },
      ],
      total: 3,
      next: expect.any(String),
    });
    const defaultedLogPage = await host.harness.behavior.callRpc(
      "benchLogsList",
      {
        projectId: "project-a",
        projectVersionId: null,
        runId,
      },
    );
    expect(defaultedLogPage).toMatchObject({
      items: [
        { projectVersionId: "version-a", sequence: 0, text: "one" },
        { projectVersionId: "version-a", sequence: 1, text: "two" },
        { projectVersionId: "version-a", sequence: 2, text: "three" },
      ],
      next: null,
    });
    await expect(
      host.harness.behavior.callRpc("benchLogsList", {
        projectId: "project-a",
        projectVersionId: "@project",
        runId,
      }),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("benchLogsList", {
        projectId: "project-a",
        projectVersionId: "version-a",
        runId: "",
      }),
    ).rejects.toThrow();
    const secondLogPage = await host.harness.behavior.callRpc("benchLogsList", {
      projectId: "project-a",
      projectVersionId: "version-a",
      runId,
      pageSize: 2,
      continuation: requiredNestedString(firstLogPage, ["next"]),
    });
    expect(secondLogPage).toMatchObject({
      items: [{ sequence: 2, text: "three" }],
      total: 3,
      next: null,
    });
    const downloadedLog = await host.harness.behavior.fetchHttp(
      "GET",
      `/bench/runs/log?projectId=project-a&runId=${encodeURIComponent(runId)}`,
    );
    expect(downloadedLog.status).toBe(206);
    expect(downloadedLog.headers.get("X-BB-Log-Completeness")).toBe(
      "cached-tail",
    );
    await expect(downloadedLog.text()).resolves.toBe("one\ntwo\nthree\n");
    const artifactRecovery = await host.harness.behavior.fetchHttp(
      "GET",
      `/bench/runs/artifact?projectId=project-a&runId=${encodeURIComponent(runId)}&artifactName=report.json`,
    );
    expect(artifactRecovery.status).toBe(404);
    await expect(artifactRecovery.json()).resolves.toMatchObject({
      error: { code: "BENCH_STREAM_UNAVAILABLE" },
    });
    const downloadedAttestation = await host.harness.behavior.fetchHttp(
      "GET",
      `/bench/runs/attestation?projectId=project-a&runId=${encodeURIComponent(runId)}`,
    );
    expect(downloadedAttestation.status).toBe(200);
    await expect(downloadedAttestation.json()).resolves.toEqual({
      project: "project-a",
    });
    for (const path of [
      "/bench/runs/log?projectId=project-a&runId=run-foreign",
      "/bench/runs/attestation?projectId=project-a&runId=run-foreign",
      "/bench/runs/log?projectId=project-a&runId=run-missing",
      "/bench/runs/attestation?projectId=project-a&runId=run-missing",
    ]) {
      const unavailable = await host.harness.behavior.fetchHttp("GET", path);
      expect(unavailable.status).toBe(404);
    }
    const foreignOwnerLog = await host.harness.behavior.fetchHttp(
      "GET",
      "/bench/runs/log?projectId=project-b&runId=run-foreign",
    );
    expect(foreignOwnerLog.status).toBe(206);
    await expect(foreignOwnerLog.text()).resolves.toBe("foreign secret\n");
    const foreignOwnerAttestation = await host.harness.behavior.fetchHttp(
      "GET",
      "/bench/runs/attestation?projectId=project-b&runId=run-foreign",
    );
    expect(foreignOwnerAttestation.status).toBe(200);
    await expect(foreignOwnerAttestation.json()).resolves.toEqual({
      project: "project-b",
    });
    const traversalRejected = await host.harness.behavior.fetchHttp(
      "GET",
      "/bench/runs/artifact?projectId=project-a&runId=..%2Frun&artifactName=..%2Fsecret",
    );
    expect(traversalRejected.status).toBe(400);
    expect(host.harness.registrations.httpRoutes).toEqual([
      expect.objectContaining({
        method: "GET",
        path: "/bench/runs/log",
        auth: "local",
      }),
      expect.objectContaining({
        method: "GET",
        path: "/bench/runs/artifact",
        auth: "local",
      }),
      expect.objectContaining({
        method: "GET",
        path: "/bench/runs/attestation",
        auth: "local",
      }),
    ]);
    expect(host.harness.registrations.cli).toBeNull();

    const failedAttempt = await host.harness.behavior.callRpc(
      "benchRunAttemptStart",
      {
        projectId: "project-a",
        projectVersionId: "version-a",
        tier: "tier0",
        hostId: "host-missing",
      },
    );
    expect(failedAttempt).toMatchObject({
      success: false,
      code: "HOST_PROJECT_SOURCE_MISSING",
      message: expect.any(String),
      runId: expect.stringMatching(/^bench-/u),
    });
    const failedRunId = requiredNestedString(failedAttempt, ["runId"]);
    expect(
      context
        .db()
        .prepare(
          "SELECT status, thread_id FROM verification_runs WHERE run_id = ?",
        )
        .get(failedRunId),
    ).toEqual({ status: "failed", thread_id: null });

    const service = host.harness.behavior.runService("bench-jobs");
    service.controller.abort();
    await service.done;
  });

  it("publishes only a post-commit tiny refetch hint and suppresses idempotent hints", () => {
    const fixture = createBenchTestStore("registration-realtime");
    hosts.push(fixture.host);
    const services = createBenchCommandServices(fixture.host.bb, fixture.db);
    services.storeEvidenceCheckpoint(evidenceBundle());
    services.storeEvidenceCheckpoint(evidenceBundle());
    expect(fixture.host.harness.realtimeSignals).toEqual([
      {
        channel: "bench:changed",
        payload: { runId: "run-a", status: "completed" },
      },
    ]);
    expect(
      fixture.db
        .prepare("SELECT synced_at FROM verification_runs")
        .pluck()
        .get(),
    ).not.toBeNull();
  });
});
