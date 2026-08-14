import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  createFakePluginHost,
  makeThreadResponse,
} from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createPluginContext } from "../../lib/context.js";
import { AssuranceStudioClient } from "../../lib/remote/assurance-studio/client.js";
import { PlatformClient } from "../../lib/remote/platform/client.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { createMockPlatformState } from "../../test/mock-remote/platform/state.js";
import { registerPlatformHandlers } from "../../test/mock-remote/platform/register.js";
import { createMockRemote } from "../../test/mock-remote/server.js";
import { registerSync } from "../sync/register.js";
import { bomAppRpcContract } from "./rpc.js";
import { registerBom } from "./register.js";

const FIXTURE_ROOT = resolve(
  import.meta.dirname,
  "../../test/mock-remote/fixtures",
);

function requiredId(
  row: Record<string, unknown> | undefined,
  label: string,
): string {
  const id = row?.["id"];
  if (typeof id !== "string" || id.length === 0)
    throw new Error(`${label} has no id`);
  return id;
}

describe("registered SBOM pull surfaces", () => {
  it("pulls through the registered CLI and serves landed rows through the registered RPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "fs-sbom-registered-"));
    const host = createFakePluginHost({
      pluginId: "finite-state-sbom-registered",
      sdk: {
        projects: {
          get: async () => ({
            id: "bb-project-fs172",
            kind: "standard" as const,
            name: "FS-172",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [
              {
                id: "source-fs172",
                projectId: "bb-project-fs172",
                type: "local_path" as const,
                hostId: "host-fs172",
                path: root,
                isDefault: true,
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          }),
        },
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thread-fs172",
              projectId: "bb-project-fs172",
              environmentId: "environment-fs172",
            }),
        },
        environments: {
          get: async () => ({
            id: "environment-fs172",
            projectId: "bb-project-fs172",
            path: root,
          }),
        },
      },
    });
    const state = createMockPlatformState(FIXTURE_ROOT);
    const mock = createMockRemote({
      platformToken: "fs172-token",
      assuranceStudioKey: "unused",
      fixtureRoot: FIXTURE_ROOT,
      register(service, registry) {
        if (service === "platform") registerPlatformHandlers(registry, state);
      },
    });
    let componentRequests = 0;
    let failComponentRequest: number | null = null;
    const platform = new PlatformClient({
      baseUrl: "http://platform.mock",
      token: "fs172-token",
      async fetch(input, init) {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        if (url.pathname.includes("component")) {
          componentRequests += 1;
          if (
            failComponentRequest !== null &&
            componentRequests >= failComponentRequest
          ) {
            return new Response(
              JSON.stringify({ message: "transient component failure" }),
              {
                status: 503,
                headers: { "content-type": "application/json" },
              },
            );
          }
        }
        return mock.platform.fetch(input, init);
      },
    });
    const assuranceStudio = new AssuranceStudioClient({
      baseUrl: "http://assurance-studio.mock",
      apiKey: "unused",
      fetch: mock.assuranceStudio.fetch,
    });
    try {
      const ctx = createPluginContext(host.bb);
      const services: RemoteServices = {
        platform,
        assuranceStudio,
        forgeCompute: null,
      };
      ctx.service<RemoteServices>("remote-services", () => services);
      registerBom(host.bb, ctx);
      registerSync(host.bb, ctx);

      const projectId = requiredId(
        [...state.projects.values()][0],
        "project fixture",
      );
      const projectVersionId = requiredId(
        [...state.versions.values()][0],
        "version fixture",
      );
      const pulled = await host.harness.behavior.runCli(
        [
          "finite-state",
          "pull",
          "sbomComponent",
          "--project",
          projectId,
          "--version",
          projectVersionId,
          "--json",
        ],
        { projectId: "bb-project-fs172", threadId: "thread-fs172" },
      );

      expect(pulled).toMatchObject({ exitCode: 0, stderr: "" });
      expect(JSON.parse(pulled.stdout)).toMatchObject({
        kinds: {
          sbomComponent: {
            fetched: expect.any(Number),
            baseRows: expect.any(Number),
          },
        },
      });
      const pullReport = JSON.parse(pulled.stdout) as {
        kinds: { sbomComponent: { fetched: number; baseRows: number } };
      };
      expect(pullReport.kinds.sbomComponent.fetched).toBeGreaterThan(0);
      expect(pullReport.kinds.sbomComponent.baseRows).toBeGreaterThan(0);
      expect(
        host.harness.inspection.realtimeSignals.filter(
          (signal) => signal.channel === "bom:changed",
        ),
      ).toEqual([
        {
          channel: "bom:changed",
          payload: { projectVersionId },
        },
      ]);
      const acceptedComponentCount = ctx
        .db()
        .prepare(
          `SELECT COUNT(*)
           FROM sbom_components
          WHERE project_id = ? AND project_version_id = ?`,
        )
        .pluck()
        .get(projectId, projectVersionId);
      expect(acceptedComponentCount).toBeGreaterThan(0);
      expect(pullReport.kinds.sbomComponent.baseRows).toBe(
        acceptedComponentCount,
      );

      const sbomAsOf = ctx
        .db()
        .prepare<[string, string], { last_pull: string }>(
          `SELECT last_pull
           FROM sync_state
          WHERE project_id = ?
            AND project_version_id = ?
            AND entity_kind = 'sbomComponent'`,
        )
        .get(projectId, projectVersionId)!.last_pull;
      ctx
        .db()
        .prepare(
          `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES (?, ?, 'finding-error-generation', 'accepted', '["finding"]',
                 '2026-08-13T23:00:00.000Z', '2026-08-13T23:00:00.000Z',
                 '2026-08-13T23:00:00.000Z')`,
        )
        .run(projectId, projectVersionId);
      ctx
        .db()
        .prepare(
          `INSERT INTO sync_state
           (project_id, project_version_id, entity_kind, accepted_generation_id,
            last_pull, error)
         VALUES (?, ?, 'finding', 'finding-error-generation',
                 '2026-08-13T23:00:00.000Z', 'finding refresh failed')`,
        )
        .run(projectId, projectVersionId);
      ctx
        .db()
        .prepare(
          `INSERT INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at)
         VALUES ('foreign-project', 'foreign-version', 'foreign-generation',
                 'accepted', '["sbomComponent"]',
                 '2099-08-14T00:00:00.000Z', '2099-08-14T00:00:00.000Z',
                 '2099-08-14T00:00:00.000Z'),
                ('sibling-project', 'sibling-version', 'sibling-generation',
                 'accepted', '["sbomComponent"]',
                 '2000-08-14T00:00:00.000Z', '2000-08-14T00:00:00.000Z',
                 '2000-08-14T00:00:00.000Z')`,
        )
        .run();
      ctx
        .db()
        .prepare(
          `INSERT INTO sync_state
           (project_id, project_version_id, entity_kind,
            accepted_generation_id, last_pull)
         VALUES ('foreign-project', 'foreign-version', 'sbomComponent',
                 'foreign-generation', '2099-08-14T00:00:00.000Z'),
                ('sibling-project', 'sibling-version', 'sbomComponent',
                 'sibling-generation', '2000-08-14T00:00:00.000Z')`,
        )
        .run();
      ctx
        .db()
        .prepare(
          `INSERT INTO workspace_platform_project_binding
           (workspace_project_id, platform_project_id)
           VALUES ('bb-project-fs172', 'sibling-project'),
                  ('other-workspace-project', 'foreign-project')`,
        )
        .run();
      expect(
        ctx
          .db()
          .prepare(
            `SELECT platform_project_id
               FROM workspace_platform_project_binding
              WHERE workspace_project_id = 'bb-project-fs172'
              ORDER BY platform_project_id`,
          )
          .pluck()
          .all(),
      ).toEqual([projectId, "sibling-project"].sort());
      expect(
        await host.harness.behavior.callRpc("bomCachedProjectVersions", {
          projectId: "bb-project-fs172",
        }),
      ).toEqual({
        versions: [
          {
            platformProjectId: projectId,
            projectVersionId,
            asOf: sbomAsOf,
            state: "fresh",
          },
          {
            platformProjectId: "sibling-project",
            projectVersionId: "sibling-version",
            asOf: "2000-08-14T00:00:00.000Z",
            state: "fresh",
          },
        ],
        selectedPlatformProjectId: projectId,
        selectedProjectVersionId: projectVersionId,
      });
      await expect(
        host.harness.behavior.callRpc("bomCachedProjectVersions", {
          projectId: "other-workspace-project",
        }),
      ).resolves.toEqual({
        versions: [
          {
            platformProjectId: "foreign-project",
            projectVersionId: "foreign-version",
            asOf: "2099-08-14T00:00:00.000Z",
            state: "fresh",
          },
        ],
        selectedPlatformProjectId: "foreign-project",
        selectedProjectVersionId: "foreign-version",
      });

      const page = bomAppRpcContract.bomSoftwareList.output.parse(
        await host.harness.behavior.callRpc("bomSoftwareList", {
          projectId,
          projectVersionId,
          pageSize: 100,
          continuation: null,
          filters: {},
        }),
      );
      expect(page).toMatchObject({
        total: expect.any(Number),
        cache: { state: "fresh" },
      });
      expect(page.items.length).toBeGreaterThan(0);

      componentRequests = 0;
      failComponentRequest = 2;
      const failed = await host.harness.behavior.runCli(
        [
          "finite-state",
          "pull",
          "sbomComponent",
          "--project",
          projectId,
          "--version",
          projectVersionId,
        ],
        { projectId: "bb-project-fs172", threadId: "thread-fs172" },
      );
      expect(failed.exitCode).toBe(1);
      expect(
        host.harness.inspection.realtimeSignals.filter(
          (signal) => signal.channel === "bom:changed",
        ),
      ).toHaveLength(1);

      const stageDirectory = join(dirname(ctx.db().name), ".fs-sync", "bom");
      const [stageName] = await readdir(stageDirectory);
      if (!stageName)
        throw new Error("failed pull left no resumable SBOM stage");
      const stage = new Database(join(stageDirectory, stageName));
      stage.prepare("UPDATE meta SET generation_id = 'stale-generation'").run();
      stage.close();

      componentRequests = 0;
      failComponentRequest = null;
      const recovered = await host.harness.behavior.runCli(
        [
          "finite-state",
          "pull",
          "sbomComponent",
          "--project",
          projectId,
          "--version",
          projectVersionId,
          "--json",
        ],
        { projectId: "bb-project-fs172", threadId: "thread-fs172" },
      );
      expect(recovered).toMatchObject({ exitCode: 0, stderr: "" });
      expect(
        host.harness.inspection.realtimeSignals.filter(
          (signal) => signal.channel === "bom:changed",
        ),
      ).toEqual([
        { channel: "bom:changed", payload: { projectVersionId } },
        { channel: "bom:changed", payload: { projectVersionId } },
      ]);
      expect(
        ctx
          .db()
          .prepare(
            `SELECT COUNT(*)
           FROM sbom_components AS component
           JOIN sync_state AS state
             ON state.project_id = component.project_id
            AND state.project_version_id = component.project_version_id
            AND state.entity_kind = 'sbomComponent'
            AND state.accepted_generation_id = component.generation_id
          WHERE component.project_id = ? AND component.project_version_id = ?`,
          )
          .pluck()
          .get(projectId, projectVersionId),
      ).toBeGreaterThan(0);
    } finally {
      platform.close();
      assuranceStudio.close();
      await mock.close();
      await host.harness.lifecycle.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
