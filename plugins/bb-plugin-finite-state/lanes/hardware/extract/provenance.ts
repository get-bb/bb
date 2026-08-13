import { lstat, readdir } from "node:fs/promises";
import type Database from "better-sqlite3";
import { resolveInsideRoot } from "../discovery.js";
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

export interface ArtifactRow {
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

function status(row: ArtifactRow, currentHash: string, pathPresent: boolean): HwArtifactStatus {
  return {
    projectKey: row.project_key,
    kind: row.kind,
    sheetPath: row.sheet_path,
    path: row.path,
    sourceHash: row.source_hash,
    cliVersion: row.cli_version,
    generatedAt: row.generated_at,
    fresh: row.source_hash === currentHash && pathPresent,
  };
}

export async function artifactPathPresent(
  sourceRoot: string,
  path: string,
  kind: HwArtifactKind,
): Promise<boolean> {
  try {
    const target = resolveInsideRoot(sourceRoot, path);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) return false;
    if (kind === "gerber" || kind === "drill") {
      if (!metadata.isDirectory()) return false;
      const entries = await readdir(target, { withFileTypes: true });
      return entries.some((entry) => entry.isFile() && !entry.isSymbolicLink());
    }
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

export async function listArtifactStatus(
  db: Database.Database,
  scope: ArtifactScope,
  sourceHashes: { schematic: string; board: string | null },
  sourceRoot: string,
): Promise<HwArtifactStatus[]> {
  const rows = db.prepare<[string, string, string], ArtifactRow>(
    `SELECT project_key, kind, sheet_path, path, source_hash, cli_version, generated_at
       FROM hw_artifact
      WHERE project_id = ? AND project_version_id = ? AND project_key = ?
      ORDER BY kind, COALESCE(sheet_path, ''), path`,
  ).all(scope.projectId, scope.projectVersionId, scope.projectKey);
  return Promise.all(rows.map(async (row) => status(
    row,
    row.kind === "board_svg" || row.kind === "glb" || row.kind === "gerber" ||
      row.kind === "drill" || row.kind === "drc"
      ? sourceHashes.board ?? ""
      : sourceHashes.schematic,
    await artifactPathPresent(sourceRoot, row.path, row.kind),
  )));
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

export function findArtifacts(
  db: Database.Database,
  scope: ArtifactScope,
  kind: HwArtifactKind,
): ArtifactRow[] {
  return db.prepare<[string, string, string, HwArtifactKind], ArtifactRow>(
    `SELECT project_key, kind, sheet_path, path, source_hash, cli_version, generated_at
       FROM hw_artifact
      WHERE project_id = ? AND project_version_id = ? AND project_key = ? AND kind = ?
      ORDER BY COALESCE(sheet_path, ''), path`,
  ).all(scope.projectId, scope.projectVersionId, scope.projectKey, kind);
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

export function replaceArtifactsForKind(
  db: Database.Database,
  scope: ArtifactScope,
  kind: HwArtifactKind,
  artifacts: Array<Omit<HwArtifactStatus, "fresh" | "projectKey">>,
): HwArtifactStatus[] {
  return db.transaction(() => {
    db.prepare(
      `DELETE FROM hw_artifact
        WHERE project_id = ? AND project_version_id = ? AND project_key = ? AND kind = ?`,
    ).run(scope.projectId, scope.projectVersionId, scope.projectKey, kind);
    return artifacts.map((artifact) => recordArtifact(db, scope, artifact));
  })();
}

export function countArtifactsAffected(
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
