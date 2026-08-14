import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { registerFindingsRpc } from "../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () =>
  Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())),
);

describe("legacy cached-project scope", () => {
  it("keeps a two-project unbound store visible without inventing a binding", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-legacy-multi-project-scope",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
      },
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('legacy-platform-a', 'legacy-version-a', 'legacy-generation-a',
               'accepted', '["finding"]', ?, ?, ?),
              ('legacy-platform-b', 'legacy-version-b', 'legacy-generation-b',
               'accepted', '["finding"]', ?, ?, ?)`,
    ).run(
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T01:00:00.000Z",
      "2026-08-12T01:00:00.000Z",
      "2026-08-12T01:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        last_pull)
       VALUES ('legacy-platform-a', 'legacy-version-a', 'finding',
               'legacy-generation-a', '2026-08-12T00:00:00.000Z'),
              ('legacy-platform-b', 'legacy-version-b', 'finding',
               'legacy-generation-b', '2026-08-12T01:00:00.000Z')`,
    ).run();
    registerFindingsRpc(host.bb, db);

    const readVersions = async (workspaceProjectId: string) => {
      const result = await host.harness.callRpc("cachedProjectVersions", {
        projectId: workspaceProjectId,
      });
      if (
        typeof result !== "object" ||
        result === null ||
        !("versions" in result) ||
        !Array.isArray(result.versions)
      ) {
        throw new Error("cachedProjectVersions returned an invalid result");
      }
      return result.versions.map((version) => {
        if (
          typeof version !== "object" ||
          version === null ||
          !("platformProjectId" in version)
        ) {
          throw new Error("cachedProjectVersions returned an invalid version");
        }
        return version.platformProjectId;
      });
    };
    const bindings = () =>
      db
        .prepare(
          `SELECT workspace_project_id, platform_project_id
             FROM workspace_platform_project_binding
            ORDER BY workspace_project_id, platform_project_id`,
        )
        .all();

    await expect(readVersions("legacy-workspace-a")).resolves.toEqual([
      "legacy-platform-b",
      "legacy-platform-a",
    ]);
    expect(bindings()).toEqual([]);
    await expect(readVersions("legacy-workspace-b")).resolves.toEqual([
      "legacy-platform-b",
      "legacy-platform-a",
    ]);
    expect(bindings()).toEqual([]);

    db.prepare(
      `INSERT INTO workspace_platform_project_binding
       (workspace_project_id, platform_project_id)
       VALUES ('existing-workspace', 'existing-platform')`,
    ).run();
    db.prepare(
      `DELETE FROM sync_state
        WHERE project_id = 'legacy-platform-b'`,
    ).run();

    await expect(readVersions("legacy-workspace-c")).resolves.toEqual([
      "legacy-platform-a",
    ]);
    expect(bindings()).toEqual([
      {
        workspace_project_id: "existing-workspace",
        platform_project_id: "existing-platform",
      },
    ]);
  });
});
