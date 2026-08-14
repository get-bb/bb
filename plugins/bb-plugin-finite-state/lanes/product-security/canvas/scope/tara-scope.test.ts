import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { PROJECT_LEVEL_VERSION_ID } from "../../../../lib/store/index.js";
import { registerThreatOverlayBackend } from "../threat-overlay/backend.js";
import { registerTaraScopeBackend, taraScopeRpcContract } from "./backend.js";

const WORKSPACE = "workspace-fs202";
const FOREIGN_WORKSPACE = "workspace-foreign";
const PLATFORM = "platform-fs202";
const VERSION_1 = "version-1";
const VERSION_2 = "version-2";
const LEGACY_GENERATION = "generation-legacy";

function acceptedGeneration(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  version: string,
  generation: string,
  acceptedAt: string,
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at, error)
     VALUES (?, ?, ?, 'accepted', '[]', ?, ?, ?, NULL)`,
  ).run(PLATFORM, version, generation, acceptedAt, acceptedAt, acceptedAt);
}

function acceptedState(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  version: string,
  generation: string,
  kind: string,
  lastPull: string,
): void {
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation,
        staged_pages, staged_rows, last_pull, error)
     VALUES (?, ?, ?, ?, NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run(PLATFORM, version, kind, generation, lastPull);
}

function snapshot(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
  version: string,
  generation: string,
  kind: string,
  key: string,
  payload: Record<string, unknown>,
): void {
  db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-08-14T10:00:00.000Z')`,
  ).run(
    PLATFORM,
    version,
    kind,
    generation,
    key,
    `remote-${key}`,
    JSON.stringify(payload),
    `hash-${key}`,
  );
  db.prepare(
    `INSERT INTO id_map
       (project_id, project_version_id, entity_kind, generation_id,
        entity_key, remote_id, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, '2026-08-14T10:00:00.000Z')`,
  ).run(PLATFORM, version, kind, generation, key, `remote-${key}`);
}

describe("registered version-scoped TARA resolution", () => {
  it("keeps legacy-only resolution read-only and promotes into a new version", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "finite-state-legacy-only",
      sdk: {
        projects: {
          get: async ({ projectId }) => {
            if (projectId !== WORKSPACE) throw new Error("unknown workspace");
            return {
              id: projectId,
              sources: [
                { hostId: "host-1", path: "/workspace", isDefault: true },
              ],
            };
          },
        },
        files: {
          list: () => {
            throw new Error("ENOENT: directory does not exist");
          },
        },
      },
    });
    const ctx = createPluginContext(bb);
    const db = ctx.db();
    db.prepare(
      `INSERT INTO workspace_platform_project_binding
         (workspace_project_id, platform_project_id)
       VALUES (?, ?)`,
    ).run(WORKSPACE, PLATFORM);
    acceptedGeneration(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "2026-08-14T10:00:00.000Z",
    );
    acceptedState(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "2026-08-14T10:00:00.000Z",
    );
    snapshot(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "api",
      {
        slug: "api",
        name: "API",
      },
    );
    registerTaraScopeBackend(bb, ctx);
    registerThreatOverlayBackend(bb, ctx);

    const before = db
      .prepare("SELECT COUNT(*) AS count FROM pull_generation")
      .get();
    await expect(
      harness.behavior.callRpc("taraScopeResolve", {
        workspaceProjectId: WORKSPACE,
        explicit: null,
      }),
    ).resolves.toMatchObject({
      versions: [],
      selected: null,
      source: "local",
      legacy: { platformProjectId: PLATFORM, kinds: ["component"] },
    });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM pull_generation").get(),
    ).toEqual(before);

    await expect(
      harness.behavior.callRpc("taraScopePromote", {
        workspaceProjectId: WORKSPACE,
        platformProjectId: PLATFORM,
        projectVersionId: "brand-new-version",
      }),
    ).resolves.toMatchObject({ promotedKinds: ["component"] });
    expect(
      db
        .prepare(
          `SELECT entity_key FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ?`,
        )
        .all(PLATFORM, "brand-new-version"),
    ).toEqual([{ entity_key: "api" }]);
  });

  it("refuses an unbound workspace attempting to discover or promote another workspace's legacy TARA", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "finite-state-foreign-promotion",
      sdk: {
        projects: {
          get: async ({ projectId }) => {
            if (![WORKSPACE, FOREIGN_WORKSPACE].includes(projectId)) {
              throw new Error("unknown workspace");
            }
            return { id: projectId, sources: [] };
          },
        },
      },
    });
    const ctx = createPluginContext(bb);
    const db = ctx.db();
    db.prepare(
      `INSERT INTO workspace_platform_project_binding
         (workspace_project_id, platform_project_id)
       VALUES (?, ?)`,
    ).run(WORKSPACE, PLATFORM);
    acceptedGeneration(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "2026-08-14T10:00:00.000Z",
    );
    acceptedState(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "2026-08-14T10:00:00.000Z",
    );
    snapshot(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "api",
      { slug: "api", name: "API" },
    );
    registerTaraScopeBackend(bb, ctx);
    registerThreatOverlayBackend(bb, ctx);

    await expect(
      harness.behavior.callRpc("taraScopeResolve", {
        workspaceProjectId: FOREIGN_WORKSPACE,
        explicit: null,
      }),
    ).resolves.toEqual({
      versions: [],
      selected: null,
      source: "local",
      legacy: null,
    });
    await expect(
      harness.behavior.callRpc("taraScopePromote", {
        workspaceProjectId: FOREIGN_WORKSPACE,
        platformProjectId: PLATFORM,
        projectVersionId: "hijacked-version",
      }),
    ).rejects.toThrow(/not associated/iu);
    await expect(
      harness.behavior.callRpc("threatOverlaySnapshot", {
        workspaceProjectId: FOREIGN_WORKSPACE,
        projectId: PLATFORM,
        projectVersionId: "hijacked-version",
      }),
    ).rejects.toThrow(/not associated/iu);
    expect(
      db
        .prepare(
          `SELECT workspace_project_id, platform_project_id
             FROM workspace_platform_project_binding`,
        )
        .all(),
    ).toEqual([
      { workspace_project_id: WORKSPACE, platform_project_id: PLATFORM },
    ]);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ?`,
        )
        .get(PLATFORM, "hijacked-version"),
    ).toEqual({ count: 0 });
  });

  it("promotes legacy keys deterministically and never leaks threats across a version switch", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: async ({ projectId }) => {
            if (projectId !== WORKSPACE) throw new Error("unknown workspace");
            return {
              id: projectId,
              sources: [
                { hostId: "host-1", path: "/workspace", isDefault: true },
              ],
            };
          },
        },
        files: {
          list: () => {
            throw new Error("ENOENT: directory does not exist");
          },
        },
      },
    });
    const ctx = createPluginContext(bb);
    const db = ctx.db();
    db.prepare(
      `INSERT INTO workspace_platform_project_binding
         (workspace_project_id, platform_project_id)
       VALUES (?, ?)`,
    ).run(WORKSPACE, PLATFORM);

    acceptedGeneration(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "2026-08-14T10:00:00.000Z",
    );
    acceptedState(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "2026-08-14T10:00:00.000Z",
    );
    acceptedState(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "threat",
      "2026-08-14T10:00:00.000Z",
    );
    snapshot(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "component",
      "api",
      {
        name: "API",
      },
    );
    snapshot(
      db,
      PROJECT_LEVEL_VERSION_ID,
      LEGACY_GENERATION,
      "threat",
      "legacy-threat",
      {
        name: "Legacy threat",
        category: "tampering",
        affected_components: ["api"],
      },
    );

    acceptedGeneration(
      db,
      VERSION_1,
      "generation-version-1",
      "2026-08-14T11:00:00.000Z",
    );
    acceptedState(
      db,
      VERSION_1,
      "generation-version-1",
      "threat",
      "2026-08-14T11:00:00.000Z",
    );
    snapshot(
      db,
      VERSION_1,
      "generation-version-1",
      "threat",
      "version-1-threat",
      {
        name: "Version one threat",
        category: "spoofing",
        affected_components: ["api"],
      },
    );

    acceptedGeneration(
      db,
      VERSION_2,
      "generation-version-2",
      "2026-08-14T12:00:00.000Z",
    );
    acceptedState(
      db,
      VERSION_2,
      "generation-version-2",
      "finding",
      "2026-08-14T12:00:00.000Z",
    );

    registerTaraScopeBackend(bb, ctx);
    registerThreatOverlayBackend(bb, ctx);

    const resolved = taraScopeRpcContract.taraScopeResolve.output.parse(
      await harness.behavior.callRpc("taraScopeResolve", {
        workspaceProjectId: WORKSPACE,
        explicit: null,
      }),
    );
    expect(resolved).toMatchObject({
      selected: {
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_2,
      },
      source: "latest",
      legacy: {
        platformProjectId: PLATFORM,
        kinds: ["component", "threat"],
      },
    });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ?`,
        )
        .get(PLATFORM, VERSION_2),
    ).toEqual({ count: 0 });

    const promotion = await harness.behavior.callRpc("taraScopePromote", {
      workspaceProjectId: WORKSPACE,
      platformProjectId: PLATFORM,
      projectVersionId: VERSION_2,
    });
    expect(promotion).toMatchObject({
      selected: {
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_2,
      },
      promotedKinds: ["component", "threat"],
    });
    expect(
      db
        .prepare(
          `SELECT entity_kind, entity_key, remote_id, payload, content_hash
             FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ?
            ORDER BY entity_kind, entity_key`,
        )
        .all(PLATFORM, VERSION_2),
    ).toEqual([
      {
        entity_kind: "component",
        entity_key: "api",
        remote_id: "remote-api",
        payload: JSON.stringify({ name: "API" }),
        content_hash: "hash-api",
      },
      {
        entity_kind: "threat",
        entity_key: "legacy-threat",
        remote_id: "remote-legacy-threat",
        payload: JSON.stringify({
          name: "Legacy threat",
          category: "tampering",
          affected_components: ["api"],
        }),
        content_hash: "hash-legacy-threat",
      },
    ]);
    const promotedGeneration = db
      .prepare(
        `SELECT generation_id FROM pull_generation
          WHERE project_id = ? AND project_version_id = ?
            AND generation_id LIKE 'tara-scope-promotion-%'`,
      )
      .get(PLATFORM, VERSION_2);
    expect(promotedGeneration).toEqual({
      generation_id: expect.stringMatching(
        /^tara-scope-promotion-[a-f0-9]{32}$/u,
      ),
    });
    await expect(
      harness.behavior.callRpc("taraScopePromote", {
        workspaceProjectId: WORKSPACE,
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_2,
      }),
    ).resolves.toMatchObject({ promotedKinds: ["component", "threat"] });

    const repeated = await harness.behavior.callRpc("taraScopeResolve", {
      workspaceProjectId: WORKSPACE,
      explicit: {
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_2,
      },
    });
    expect(repeated).toMatchObject({ source: "explicit" });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM pull_generation
            WHERE project_id = ? AND project_version_id = ?
              AND generation_id LIKE 'tara-scope-promotion-%'`,
        )
        .get(PLATFORM, VERSION_2),
    ).toEqual({ count: 1 });

    const switched = await harness.behavior.callRpc("taraScopeResolve", {
      workspaceProjectId: WORKSPACE,
      explicit: {
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_1,
      },
    });
    expect(switched).toMatchObject({ source: "explicit" });
    await expect(
      harness.behavior.callRpc("taraScopePromote", {
        workspaceProjectId: WORKSPACE,
        platformProjectId: PLATFORM,
        projectVersionId: VERSION_1,
      }),
    ).rejects.toThrow(/requires an empty version/u);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM base_snapshot
            WHERE project_id = ? AND project_version_id = ?
              AND entity_kind = 'component'`,
        )
        .get(PLATFORM, VERSION_1),
    ).toEqual({ count: 0 });
    const versionOne = await harness.behavior.callRpc("threatOverlaySnapshot", {
      workspaceProjectId: WORKSPACE,
      projectId: PLATFORM,
      projectVersionId: VERSION_1,
    });
    const versionTwo = await harness.behavior.callRpc("threatOverlaySnapshot", {
      workspaceProjectId: WORKSPACE,
      projectId: PLATFORM,
      projectVersionId: VERSION_2,
    });
    expect(versionOne).toMatchObject({
      projectVersionId: VERSION_1,
      threats: [{ slug: "version-1-threat" }],
      total: 1,
    });
    expect(versionTwo).toMatchObject({
      projectVersionId: VERSION_2,
      threats: [{ slug: "legacy-threat" }],
      total: 1,
    });
  });
});
