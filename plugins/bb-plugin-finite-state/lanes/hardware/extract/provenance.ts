import type Database from "better-sqlite3";
import type { HwArtifactKind } from "./driver.js";

export interface HwArtifactStatus {
  projectKey: string;
  kind: HwArtifactKind;
  sheetPath: string | null;
  path: string;
  sourceHash: string;
  cliVersion: string | null;
  generatedAt: string;
  fresh: boolean;
}

interface ArtifactRow {
  project_key: string;
  kind: HwArtifactKind;
  sheet_path: string | null;
  path: string;
  source_hash: string;
  cli_version: string | null;
  generated_at: string;
}

export interface ArtifactScope {
  projectId: string;
  projectVersionId: string;
  projectKey: string;
}

function status(row: ArtifactRow, currentHash: string): HwArtifactStatus {
  return {
    projectKey: row.project_key,
    kind: row.kind,
    sheetPath: row.sheet_path,
    path: row.path,
    sourceHash: row.source_hash,
    cliVersion: row.cli_version,
    generatedAt: row.generated_at,
    fresh: row.source_hash === currentHash,
  };
}

export function listArtifactStatus(
  db: Database.Database,
  scope: ArtifactScope,
  sourceHashes: { schematic: string; board: string | null },
): HwArtifactStatus[] {
  const rows = db.prepare<[string, string, string], ArtifactRow>(
    `SELECT project_key, kind, sheet_path, path, source_hash, cli_version, generated_at
       FROM hw_artifact
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
      ORDER BY kind, COALESCE(sheet_path, ''), path`,
  ).all(scope.projectId, scope.projectVersionId, scope.projectKey);
  return rows.map((row) => status(
    row,
    row.kind === "board_svg" || row.kind === "glb" || row.kind === "gerber" ||
      row.kind === "drill" || row.kind === "drc"
      ? sourceHashes.board ?? ""
      : sourceHashes.schematic,
  ));
}

export function findArtifact(
  db: Database.Database,
  scope: ArtifactScope,
  kind: HwArtifactKind,
  sheetPath: string | null,
): ArtifactRow | undefined {
  return db.prepare<[string, string, string, HwArtifactKind, string], ArtifactRow>(
    `SELECT project_key, kind, sheet_path, path, source_hash, cli_version, generated_at
       FROM hw_artifact
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
        AND kind = ? AND COALESCE(sheet_path, '') = ?`,
  ).get(scope.projectId, scope.projectVersionId, scope.projectKey, kind, sheetPath ?? "");
}

export function recordArtifact(
  db: Database.Database,
  scope: ArtifactScope,
  artifact: Omit<HwArtifactStatus, "fresh" | "projectKey">,
): HwArtifactStatus {
  db.transaction(() => {
    db.prepare(
      `DELETE FROM hw_artifact
        WHERE project_id = ? AND project_version_id = ? AND project_key = ?
          AND kind = ? AND COALESCE(sheet_path, '') = ?`,
    ).run(scope.projectId, scope.projectVersionId, scope.projectKey, artifact.kind, artifact.sheetPath ?? "");
    db.prepare(
      `INSERT INTO hw_artifact (
       project_id, project_version_id, project_key, kind, sheet_path, path,
       source_hash, cli_version, generated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      scope.projectId, scope.projectVersionId, scope.projectKey, artifact.kind,
      artifact.sheetPath, artifact.path, artifact.sourceHash, artifact.cliVersion,
      artifact.generatedAt,
    );
  })();
  return { ...artifact, projectKey: scope.projectKey, fresh: true };
}

export function markArtifactsStale(
  db: Database.Database,
  scope: ArtifactScope,
  changedSource: "schematic" | "board",
): number {
  const kinds = changedSource === "board"
    ? ["board_svg", "glb", "gerber", "drill", "drc"]
    : ["sheet_svg", "bom", "netlist", "erc"];
  const row = db.prepare<unknown[], { count: number }>(
    `SELECT COUNT(*) AS count FROM hw_artifact
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
        AND kind IN (${kinds.map(() => "?").join(", ")})`,
  ).get(scope.projectId, scope.projectVersionId, scope.projectKey, ...kinds);
  // Freshness is derived by comparing the immutable provenance hash with the
  // current source hash. A watch event only prompts that refetch.
  return row?.count ?? 0;
}
