import { createHash } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { PluginContext } from "../../../../lib/context.js";
import { PROJECT_LEVEL_VERSION_ID } from "../../../../lib/store/index.js";
import { rpcContract } from "../../../../shared/contract.js";
import { assertWorkspacePlatformProjectBinding } from "./identity.js";

const TARA_ENTITY_KINDS = [
  "asset",
  "component",
  "dataflow",
  "threat",
  "zone",
] as const;

const explicitScopeSchema = z
  .object({
    platformProjectId: z.string().trim().min(1).max(512),
    projectVersionId: z.string().trim().min(1).max(512),
  })
  .strict();

const versionSchema = explicitScopeSchema.extend({
  asOf: z.string().nullable(),
});

const legacySchema = z
  .object({
    platformProjectId: z.string().trim().min(1).max(512),
    kinds: z.array(z.enum(TARA_ENTITY_KINDS)).min(1),
  })
  .strict();

export const taraCanvasRpcContract = defineRpcContract({
  taraCanvasList: {
    input: z
      .object({
        workspaceProjectId: z.string().trim().min(1).max(512),
        platformProjectId: z.string().trim().min(1).max(512),
        projectVersionId: z.string().trim().min(1).max(512).nullable(),
        kind: z.enum(TARA_ENTITY_KINDS),
        pageSize: z.number().int().min(1).max(500).default(50),
        continuation: z.string().min(1).max(4096).nullable().default(null),
      })
      .strict(),
    output: rpcContract.taraList.output,
  },
});

export const taraScopeRpcContract = defineRpcContract({
  taraScopeResolve: {
    input: z
      .object({
        workspaceProjectId: z.string().trim().min(1).max(512),
        explicit: explicitScopeSchema.nullable().default(null),
      })
      .strict(),
    output: z
      .object({
        versions: z.array(versionSchema).max(1_000),
        selected: versionSchema.nullable(),
        source: z.enum(["explicit", "latest", "local"]),
        legacy: legacySchema.nullable(),
      })
      .strict(),
  },
  taraScopePromote: {
    input: z
      .object({
        workspaceProjectId: z.string().trim().min(1).max(512),
        platformProjectId: z.string().trim().min(1).max(512),
        projectVersionId: z.string().trim().min(1).max(512),
      })
      .strict(),
    output: z
      .object({
        selected: versionSchema,
        promotedKinds: z.array(z.enum(TARA_ENTITY_KINDS)).min(1),
      })
      .strict(),
  },
});

type TaraEntityKind = (typeof TARA_ENTITY_KINDS)[number];
type ExplicitScope = z.output<typeof explicitScopeSchema>;
type Version = z.output<typeof versionSchema>;

interface VersionRow {
  project_id: string;
  project_version_id: string;
  as_of: string | null;
}

interface LegacySyncRow {
  entity_kind: TaraEntityKind;
  accepted_generation_id: string;
  base_revision: number;
  last_pull: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  accepted_at: string | null;
}

interface TargetSyncRow {
  entity_kind: string;
  accepted_generation_id: string | null;
  staging_generation_id: string | null;
}

interface LegacyCatalogRow {
  project_id: string;
  entity_kind: TaraEntityKind;
}

function versionRows(
  db: Database.Database,
  workspaceProjectId: string,
): Version[] {
  const rows = db
    .prepare<[string, string], VersionRow>(
      `SELECT s.project_id, s.project_version_id, MAX(s.last_pull) AS as_of
         FROM sync_state AS s
         JOIN workspace_platform_project_binding AS binding
           ON binding.platform_project_id = s.project_id
          AND binding.workspace_project_id = ?
        WHERE s.project_version_id <> ?
          AND s.accepted_generation_id IS NOT NULL
        GROUP BY s.project_id, s.project_version_id
        ORDER BY as_of DESC, s.project_id ASC, s.project_version_id DESC`,
    )
    .all(workspaceProjectId, PROJECT_LEVEL_VERSION_ID);
  return rows.map((row) => ({
    platformProjectId: row.project_id,
    projectVersionId: row.project_version_id,
    asOf: row.as_of,
  }));
}

function legacyTara(
  db: Database.Database,
  workspaceProjectId: string,
): z.output<typeof legacySchema> | null {
  const rows = db
    .prepare<[string, string], LegacyCatalogRow>(
      `SELECT s.project_id, s.entity_kind
         FROM sync_state AS s
         JOIN workspace_platform_project_binding AS binding
           ON binding.workspace_project_id = ?
          AND binding.platform_project_id = s.project_id
        WHERE s.project_version_id = ?
          AND s.entity_kind IN ('asset','component','dataflow','threat','zone')
          AND s.accepted_generation_id IS NOT NULL
        ORDER BY s.project_id, s.entity_kind`,
    )
    .all(workspaceProjectId, PROJECT_LEVEL_VERSION_ID);
  const projects = [...new Set(rows.map((row) => row.project_id))];
  if (projects.length !== 1) return null;
  return {
    platformProjectId: projects[0]!,
    kinds: rows.map((row) => row.entity_kind),
  };
}

function sameScope(left: ExplicitScope, right: ExplicitScope): boolean {
  return (
    left.platformProjectId === right.platformProjectId &&
    left.projectVersionId === right.projectVersionId
  );
}

function promotedGenerationId(
  platformProjectId: string,
  projectVersionId: string,
  sources: readonly LegacySyncRow[],
): string {
  const digest = createHash("sha256")
    .update(
      [
        platformProjectId,
        projectVersionId,
        ...sources.map(
          (source) => `${source.entity_kind}:${source.accepted_generation_id}`,
        ),
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 32);
  return `tara-scope-promotion-${digest}`;
}

function copyGenerationRows(
  db: Database.Database,
  platformProjectId: string,
  projectVersionId: string,
  sourceGenerationId: string,
  targetGenerationId: string,
  kinds: readonly TaraEntityKind[],
): void {
  const placeholders = kinds.map(() => "?").join(",");
  const scope = [
    platformProjectId,
    projectVersionId,
    targetGenerationId,
    platformProjectId,
    PROJECT_LEVEL_VERSION_ID,
    sourceGenerationId,
  ];
  db.prepare(
    `INSERT OR IGNORE INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        remote_id, payload, content_hash, pulled_at)
     SELECT ?, ?, entity_kind, ?, entity_key, remote_id, payload, content_hash,
            pulled_at
       FROM base_snapshot
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND entity_kind IN (${placeholders})`,
  ).run(...scope, ...kinds);
  db.prepare(
    `INSERT OR IGNORE INTO id_map
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        remote_id, pulled_at)
     SELECT ?, ?, entity_kind, ?, entity_key, remote_id, pulled_at
       FROM id_map
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND entity_kind IN (${placeholders})`,
  ).run(...scope, ...kinds);
  db.prepare(
    `INSERT OR IGNORE INTO entity_review_state
       (project_id, project_version_id, generation_id, entity_kind, entity_key,
        remote_id, review_status, review_version, pulled_at)
     SELECT ?, ?, ?, entity_kind, entity_key, remote_id, review_status,
            review_version, pulled_at
       FROM entity_review_state
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND entity_kind IN (${placeholders})`,
  ).run(...scope, ...kinds);

  db.prepare(
    `INSERT OR IGNORE INTO methodology_profiles
     SELECT project_id, ?, ?, profile_id, organization_id, scope, name,
            asset_properties, impact_dimensions, risk_scale, assurance_levels,
            ownership_labels, stride_map, review_version, raw, pulled_at
       FROM methodology_profiles
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
  ).run(
    projectVersionId,
    targetGenerationId,
    platformProjectId,
    PROJECT_LEVEL_VERSION_ID,
    sourceGenerationId,
  );
  db.prepare(
    `INSERT OR IGNORE INTO attack_paths
     SELECT project_id, ?, ?, path_id, route_signature, name, threat_key,
            steps, edges, total_steps, zones_traversed, exploitability,
            review_status, review_version, raw, pulled_at
       FROM attack_paths
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
  ).run(
    projectVersionId,
    targetGenerationId,
    platformProjectId,
    PROJECT_LEVEL_VERSION_ID,
    sourceGenerationId,
  );
}

/**
 * Promote the complete accepted legacy @project TARA snapshot into an empty
 * version. Any real accepted or staging TARA state rejects the whole action;
 * per-kind mixing is forbidden.
 */
export function promoteLegacyProjectTara(
  db: Database.Database,
  scope: ExplicitScope,
): TaraEntityKind[] {
  return db.transaction(() => {
    const source = db
      .prepare<[string, string], LegacySyncRow>(
        `SELECT state.entity_kind, state.accepted_generation_id,
                state.base_revision, state.last_pull, state.error,
                generation.started_at, generation.completed_at,
                generation.accepted_at
           FROM sync_state AS state
           JOIN pull_generation AS generation
             ON generation.project_id = state.project_id
            AND generation.project_version_id = state.project_version_id
            AND generation.generation_id = state.accepted_generation_id
            AND generation.status = 'accepted'
          WHERE state.project_id = ? AND state.project_version_id = ?
            AND state.entity_kind IN ('asset','component','dataflow','threat','zone')
            AND state.accepted_generation_id IS NOT NULL
          ORDER BY state.entity_kind`,
      )
      .all(scope.platformProjectId, PROJECT_LEVEL_VERSION_ID);
    const target = db
      .prepare<[string, string], TargetSyncRow>(
        `SELECT entity_kind, accepted_generation_id, staging_generation_id
           FROM sync_state
          WHERE project_id = ? AND project_version_id = ?
            AND entity_kind IN ('asset','component','dataflow','threat','zone')`,
      )
      .all(scope.platformProjectId, scope.projectVersionId);
    if (source.length === 0) {
      throw new Error("No accepted legacy project-scoped TARA is available.");
    }
    const kinds = source.map((row) => row.entity_kind).sort();
    const targetGenerationId = promotedGenerationId(
      scope.platformProjectId,
      scope.projectVersionId,
      source,
    );
    const occupied = target.filter(
      (row) =>
        row.accepted_generation_id !== null ||
        row.staging_generation_id !== null,
    );
    const replay =
      occupied.length === source.length &&
      occupied.every(
        (row) =>
          kinds.includes(row.entity_kind as TaraEntityKind) &&
          row.accepted_generation_id === targetGenerationId &&
          row.staging_generation_id === null,
      );
    if (occupied.length > 0 && !replay) {
      throw new Error(
        "The target version already has accepted or staging TARA. Promotion requires an empty version and did not write anything.",
      );
    }
    if (!replay) {
      const representative = source[0]!;
      db.prepare(
        `INSERT OR IGNORE INTO pull_generation
           (project_id, project_version_id, generation_id, status,
            requested_kinds_json, started_at, completed_at, accepted_at, error)
         VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?, NULL)`,
      ).run(
        scope.platformProjectId,
        scope.projectVersionId,
        targetGenerationId,
        JSON.stringify(kinds),
        representative.started_at,
        representative.completed_at,
        representative.accepted_at,
      );
      for (const row of source) {
        copyGenerationRows(
          db,
          scope.platformProjectId,
          scope.projectVersionId,
          row.accepted_generation_id,
          targetGenerationId,
          [row.entity_kind],
        );
        db.prepare(
          `INSERT INTO sync_state
             (project_id, project_version_id, entity_kind,
              accepted_generation_id, staging_generation_id, base_revision,
              staging_continuation, staged_pages, staged_rows, last_pull, error)
           VALUES (?, ?, ?, ?, NULL, ?, NULL, 0, 0, ?, ?)
           ON CONFLICT(project_id, project_version_id, entity_kind) DO UPDATE SET
             accepted_generation_id = excluded.accepted_generation_id,
             base_revision = MAX(sync_state.base_revision, excluded.base_revision),
             last_pull = excluded.last_pull,
             error = excluded.error
           WHERE sync_state.accepted_generation_id IS NULL
             AND sync_state.staging_generation_id IS NULL`,
        ).run(
          scope.platformProjectId,
          scope.projectVersionId,
          row.entity_kind,
          targetGenerationId,
          row.base_revision,
          row.last_pull,
          row.error,
        );
      }
    }
    return kinds;
  })();
}

export function registerTaraScopeBackend(
  bb: BbPluginApi,
  ctx: PluginContext,
): void {
  bb.rpc.register(taraScopeRpcContract, {
    async taraScopeResolve(input) {
      await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      const db = ctx.db();
      const versions = versionRows(db, input.workspaceProjectId);
      // Selection is deliberately two-tier: a valid explicit choice, then the
      // latest accepted version in the workspace-visible catalog. The project
      // binding constrains that catalog; it is not a third selection source.
      const selected =
        input.explicit &&
        versions.some((version) => sameScope(version, input.explicit!))
          ? versions.find((version) => sameScope(version, input.explicit!))!
          : (versions[0] ?? null);
      return {
        versions,
        selected,
        source:
          input.explicit && selected && sameScope(input.explicit, selected)
            ? ("explicit" as const)
            : selected
              ? ("latest" as const)
              : ("local" as const),
        legacy: legacyTara(db, input.workspaceProjectId),
      };
    },
    async taraScopePromote(input) {
      await bb.sdk.projects.get({ projectId: input.workspaceProjectId });
      const db = ctx.db();
      assertWorkspacePlatformProjectBinding(
        db,
        input.workspaceProjectId,
        input.platformProjectId,
      );
      const legacy = legacyTara(db, input.workspaceProjectId);
      if (!legacy || legacy.platformProjectId !== input.platformProjectId) {
        throw new Error(
          "The selected workspace has no unambiguous legacy TARA for that Platform project.",
        );
      }
      const promotedKinds = promoteLegacyProjectTara(db, input);
      const selected = {
        platformProjectId: input.platformProjectId,
        projectVersionId: input.projectVersionId,
        asOf: new Date().toISOString(),
      };
      bb.realtime.publish("tara:changed", {
        workspaceProjectId: input.workspaceProjectId,
        projectId: input.platformProjectId,
        projectVersionId: input.projectVersionId,
      });
      return { selected, promotedKinds };
    },
  });
}
