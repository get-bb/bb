import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { registerRemoteServices } from "../remote/register.js";
import { createBenchCommandServices, registerBench } from "./register.js";
import { createBenchTestStore, evidenceBundle } from "./store/test-helpers.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
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
    const response = await host.harness.behavior.fetchHttp("GET", "/bench/runs/artifact");
    expect(response.status).toBe(501);
    expect(host.harness.registrations.cli).toBeNull();

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
      { channel: "bench:changed", payload: { runId: "run-a", status: "completed" } },
    ]);
    expect(
      fixture.db.prepare("SELECT synced_at FROM verification_runs").pluck().get(),
    ).not.toBeNull();
  });
});
