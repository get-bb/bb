import type Database from "better-sqlite3";
import {
  canonicalFindingStableKey,
  canonicalizeFindingIdentity,
} from "../../findings/stable-key/canonical.js";

const SBOM_COMPONENT_DISCRIMINATOR = "SBOM-COMPONENT";

function normalizeNonEmpty(value: string, label: string): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  return normalized;
}

/**
 * Uses the shared wire-only canonicalizer so file paths and package namespaces
 * join the same finding identity without consulting the tenant-wide index.
 */
export function componentKeyFromIdentity(identity: {
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
}): string {
  const purl =
    identity.purl === null
      ? null
      : normalizeNonEmpty(identity.purl, "component purl");
  // The shared canonicalizer validates every fallback segment before selecting
  // its purl tier. Use an inert fallback for purl identities so ordinary
  // firmware paths cannot invalidate an otherwise exact purl.
  const name =
    purl === null
      ? normalizeNonEmpty(identity.name, "component name")
      : "purl-identified-component";
  return canonicalFindingStableKey(
    canonicalizeFindingIdentity({
      cve: SBOM_COMPONENT_DISCRIMINATOR,
      purl,
      name,
      group: purl === null ? identity.group : null,
      version: purl === null ? identity.version : null,
    }),
  );
}

interface RollupOptions {
  projectId?: string;
  generationId?: string;
  computedAt?: string;
  warn?: (
    message: string,
    details: { count: number; projectVersionId: string },
  ) => void;
}

interface ScopeRow {
  project_id: string;
  accepted_generation_id: string;
}

function resolveScope(
  db: Database.Database,
  projectVersionId: string,
  options: RollupOptions,
): ScopeRow {
  if (options.projectId && options.generationId) {
    return {
      project_id: options.projectId,
      accepted_generation_id: options.generationId,
    };
  }
  const rows = db
    .prepare<[string], ScopeRow>(
      `SELECT project_id, accepted_generation_id
         FROM sync_state
        WHERE project_version_id = ?
          AND entity_kind = 'sbomComponent'
          AND accepted_generation_id IS NOT NULL`,
    )
    .all(projectVersionId);
  if (rows.length !== 1) {
    throw new Error("SBOM_ROLLUP_SCOPE_AMBIGUOUS: project scope is required");
  }
  return rows[0]!;
}

function installComponentKeyFunction(db: Database.Database): void {
  db.function(
    "fs_sbom_component_key",
    { deterministic: true },
    (purl: unknown, name: unknown, group: unknown, version: unknown) => {
      if (purl !== null && typeof purl !== "string") return null;
      if (typeof name !== "string") return null;
      if (group !== null && typeof group !== "string") return null;
      if (version !== null && typeof version !== "string") return null;
      try {
        return componentKeyFromIdentity({ purl, name, group, version });
      } catch {
        return null;
      }
    },
  );
}

/**
 * Rebuilds one accepted SBOM generation from the separately accepted findings
 * cache. A purl-less finding is intentionally attributed to every component
 * in the accepted slice that claims its fallback alias.
 */
export function recomputeVulnRollup(
  db: Database.Database,
  projectVersionId: string,
  options: RollupOptions = {},
): number {
  const scope = resolveScope(db, projectVersionId, options);
  const projectId = scope.project_id;
  const generationId = scope.accepted_generation_id;
  const computedAt = options.computedAt ?? new Date().toISOString();
  installComponentKeyFunction(db);

  // Materialize the expensive JS stable-key mapping exactly once per accepted
  // finding. The publication join below is then plain indexed equality rather
  // than invoking the UDF for every component/finding pair.
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS fs_sbom_finding_keys (
      finding_id TEXT PRIMARY KEY,
      component_key TEXT
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS fs_sbom_finding_keys_component
      ON fs_sbom_finding_keys(component_key);
    CREATE TEMP TABLE IF NOT EXISTS fs_sbom_component_aliases (
      component_key TEXT NOT NULL,
      alias_key TEXT NOT NULL,
      PRIMARY KEY (component_key, alias_key)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS fs_sbom_component_aliases_key
      ON fs_sbom_component_aliases(alias_key, component_key);
    DELETE FROM fs_sbom_finding_keys;
    DELETE FROM fs_sbom_component_aliases;
  `);
  db.prepare(
    `INSERT INTO fs_sbom_finding_keys (finding_id, component_key)
     SELECT f.finding_id,
            fs_sbom_component_key(
              f.component_purl, f.component_name,
              f.component_group, f.component_version
            )
       FROM findings f
       JOIN sync_state s
         ON s.project_id = f.project_id
        AND s.project_version_id = f.project_version_id
        AND s.entity_kind = 'finding'
        AND s.accepted_generation_id = f.generation_id
      WHERE f.project_id = ? AND f.project_version_id = ?`,
  ).run(projectId, projectVersionId);
  db.prepare(
    `INSERT INTO fs_sbom_component_aliases (component_key, alias_key)
     SELECT DISTINCT component_key, component_key
       FROM sbom_components
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
  ).run(projectId, projectVersionId, generationId);
  db.prepare(
    `INSERT OR IGNORE INTO fs_sbom_component_aliases
       (component_key, alias_key)
     SELECT DISTINCT component_key,
            fs_sbom_component_key(NULL, name, component_group, version)
       FROM sbom_components
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND purl IS NOT NULL`,
  ).run(projectId, projectVersionId, generationId);

  db.prepare(
    `DELETE FROM sbom_vuln_rollup
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
  ).run(projectId, projectVersionId, generationId);

  const result = db
    .prepare(
      `INSERT INTO sbom_vuln_rollup (
       project_id, project_version_id, generation_id, component_key,
       critical, high, medium, low, kev_count, max_epss,
       reachability_verdict, computed_at
     )
     WITH accepted_findings AS MATERIALIZED (
       SELECT f.*, k.component_key
         FROM findings f
         JOIN fs_sbom_finding_keys k ON k.finding_id = f.finding_id
         JOIN sync_state s
           ON s.project_id = f.project_id
          AND s.project_version_id = f.project_version_id
          AND s.entity_kind = 'finding'
          AND s.accepted_generation_id = f.generation_id
        WHERE f.project_id = ? AND f.project_version_id = ?
     ), joined AS (
       SELECT c.component_key,
              f.finding_id,
              lower(f.severity) AS severity,
              f.in_kev,
              f.in_vc_kev,
              f.epss_score,
              CASE WHEN COALESCE(f.reachability_score > 0, 0) = 1
                     OR lower(COALESCE(f.reachability_verdict, '')) IN ('reachable','positive')
                   THEN 1 ELSE 0 END AS positive,
              CASE WHEN COALESCE(f.reachability_score < 0, 0) = 1
                     OR lower(COALESCE(f.reachability_verdict, '')) IN ('unreachable','negative')
                   THEN 1 ELSE 0 END AS negative,
              CASE WHEN f.finding_id IS NOT NULL
                         AND NOT (
                           COALESCE(f.reachability_score > 0, 0) = 1
                           OR COALESCE(f.reachability_score < 0, 0) = 1
                           OR lower(COALESCE(f.reachability_verdict, '')) IN
                             ('reachable','positive','unreachable','negative')
                         )
                   THEN 1 ELSE 0 END AS inconclusive
         FROM sbom_components c
         JOIN fs_sbom_component_aliases a
           ON a.component_key = c.component_key
         LEFT JOIN accepted_findings f
           ON f.component_key = a.alias_key
        WHERE c.project_id = ? AND c.project_version_id = ?
          AND c.generation_id = ?
     )
     SELECT ?, ?, ?, component_key,
            COUNT(DISTINCT CASE WHEN severity = 'critical' THEN finding_id END),
            COUNT(DISTINCT CASE WHEN severity = 'high' THEN finding_id END),
            COUNT(DISTINCT CASE WHEN severity = 'medium' THEN finding_id END),
            COUNT(DISTINCT CASE WHEN severity = 'low' THEN finding_id END),
            COUNT(DISTINCT CASE WHEN in_kev = 1 OR in_vc_kev = 1 THEN finding_id END),
            MAX(epss_score),
            CASE
              WHEN MAX(positive) = 1 AND MAX(negative) = 1 THEN 'mixed'
              WHEN MAX(positive) = 1 THEN 'reachable'
              WHEN MAX(negative) = 1 AND MAX(inconclusive) = 0 THEN 'unreachable'
              ELSE 'unknown'
            END,
            ?
       FROM joined
      GROUP BY component_key`,
    )
    .run(
      projectId,
      projectVersionId,
      projectId,
      projectVersionId,
      generationId,
      projectId,
      projectVersionId,
      generationId,
      computedAt,
    );

  const ignored = db
    .prepare<[], { count: number }>(
      `SELECT COUNT(*) AS count
       FROM fs_sbom_finding_keys k
       LEFT JOIN fs_sbom_component_aliases a
         ON a.alias_key = k.component_key
      WHERE a.component_key IS NULL`,
    )
    .get()!;
  if (ignored.count > 0) {
    options.warn?.("Ignored findings without a resolvable SBOM component", {
      count: ignored.count,
      projectVersionId,
    });
  }
  return result.changes;
}
