import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import Database from "better-sqlite3";
import { RemoteError, type Json } from "../../../lib/remote/types.js";
import { componentKeyFromIdentity, recomputeVulnRollup } from "./rollup.js";
import type { BomDeps, SbomPullInput, SbomPullResult } from "./types.js";
import { SbomPullError } from "./types.js";

const ENTITY_KIND = "sbomComponent";
const DEFAULT_PAGE_SIZE = 200;

interface SyncRow {
  accepted_generation_id: string | null;
  staging_generation_id: string | null;
  staging_continuation: string | null;
  staged_pages: number;
  staged_rows: number;
}

interface StageMeta {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  continuation: string | null;
  pages: number;
  rows: number;
}

interface NormalizedComponent {
  componentId: string;
  componentKey: string;
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
  cpe: string | null;
  license: string | null;
  supplier: string | null;
  source: string;
  fileLocations: string;
  isStale: 0 | 1;
  raw: string;
}

interface PullPhase {
  excluded: boolean;
  remoteContinuation: string | null;
}

function encodePhase(phase: PullPhase): string {
  const continuation = phase.remoteContinuation === null
    ? "-"
    : Buffer.from(phase.remoteContinuation, "utf8").toString("base64url");
  return `bp1.${phase.excluded ? "excluded" : "included"}.${continuation}`;
}

function decodePhase(continuation: string | null): PullPhase {
  if (continuation === null) return { excluded: false, remoteContinuation: null };
  const [prefix, phase, payload, extra] = continuation.split(".");
  if (prefix !== "bp1" || (phase !== "included" && phase !== "excluded") || !payload || extra !== undefined) {
    throw new SbomPullError("SBOM_RESUME_CURSOR_INVALID", "Stored SBOM resume cursor is invalid");
  }
  return {
    excluded: phase === "excluded",
    remoteContinuation: payload === "-"
      ? null
      : Buffer.from(payload, "base64url").toString("utf8"),
  };
}

function record(value: Json): Record<string, Json> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function requiredString(row: Record<string, Json>, keys: string[], label: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.normalize("NFC").trim()) {
      return value.normalize("NFC").trim();
    }
  }
  throw new SbomPullError("SBOM_INVALID_COMPONENT", `Component ${label} is missing`);
}

function optionalString(row: Record<string, Json>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (value === null) return null;
    if (typeof value === "string") {
      const normalized = value.normalize("NFC").trim();
      return normalized || null;
    }
  }
  return null;
}

function readSupplier(row: Record<string, Json>): string | null {
  const direct = optionalString(row, ["supplier", "manufacturer"]);
  if (direct) return direct;
  const supplier = record(row.supplier ?? null);
  return supplier ? optionalString(supplier, ["name"]) : null;
}

function readLicense(row: Record<string, Json>): string | null {
  const direct = optionalString(row, ["license", "licenseDeclared"]);
  if (direct) return direct;
  const licenses = row.licenses;
  if (!Array.isArray(licenses)) return null;
  for (const item of licenses) {
    if (typeof item === "string" && item.trim()) return item.normalize("NFC").trim();
    const entry = record(item);
    if (!entry) continue;
    const value = optionalString(entry, ["id", "name", "license"]);
    if (value) return value;
  }
  return null;
}

function readFiles(row: Record<string, Json>): string[] {
  for (const key of ["files", "fileLocations", "locations"]) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
      .sort((left, right) => left.localeCompare(right));
  }
  return [];
}

export function normalizeComponent(value: Json): NormalizedComponent {
  const row = record(value);
  if (!row) throw new SbomPullError("SBOM_INVALID_COMPONENT", "Component row must be an object");
  const componentId = requiredString(row, ["id", "componentId", "uuid"], "id");
  const name = requiredString(row, ["name"], "name");
  const purl = optionalString(row, ["purl", "packageUrl"]);
  const group = optionalString(row, ["group", "namespace"]);
  const version = optionalString(row, ["version"]);
  return {
    componentId,
    componentKey: componentKeyFromIdentity({ purl, name, group, version }),
    purl,
    name,
    group,
    version,
    cpe: optionalString(row, ["cpe"]),
    license: readLicense(row),
    supplier: readSupplier(row),
    source: "platform",
    fileLocations: JSON.stringify(readFiles(row)),
    isStale: row.isStale === true ? 1 : 0,
    raw: JSON.stringify(row),
  };
}

function stagingPath(worktreeRoot: string, input: SbomPullInput): string {
  if (!isAbsolute(worktreeRoot)) {
    throw new SbomPullError("SBOM_WORKTREE_REQUIRED", "SBOM staging requires an absolute worktree root");
  }
  const directory = join(worktreeRoot, ".fs-sync", "bom");
  mkdirSync(directory, { recursive: true });
  const digest = createHash("sha256")
    .update(`${input.projectId}\u0000${input.projectVersionId}`)
    .digest("hex");
  return join(directory, `${digest}.sqlite`);
}

function removeStage(path: string): void {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

function openStage(path: string): Database.Database {
  const stage = new Database(path);
  stage.pragma("journal_mode = DELETE");
  stage.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      project_id TEXT NOT NULL,
      project_version_id TEXT NOT NULL,
      generation_id TEXT NOT NULL,
      continuation TEXT,
      pages INTEGER NOT NULL,
      rows INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS components (
      component_id TEXT PRIMARY KEY,
      component_key TEXT NOT NULL,
      purl TEXT,
      name TEXT NOT NULL,
      component_group TEXT,
      version TEXT,
      cpe TEXT,
      license TEXT,
      supplier TEXT,
      source TEXT,
      file_locations TEXT,
      is_stale INTEGER NOT NULL,
      raw TEXT NOT NULL
    );
  `);
  return stage;
}

function meta(stage: Database.Database): StageMeta | undefined {
  return stage.prepare<[], StageMeta>("SELECT * FROM meta LIMIT 1").get();
}

function initializeStage(
  stage: Database.Database,
  input: SbomPullInput,
  generationId: string,
): void {
  stage.transaction(() => {
    stage.prepare("DELETE FROM components").run();
    stage.prepare("DELETE FROM meta").run();
    stage.prepare(
      `INSERT INTO meta
         (project_id, project_version_id, generation_id, continuation, pages, rows)
       VALUES (?, ?, ?, NULL, 0, 0)`,
    ).run(input.projectId, input.projectVersionId, generationId);
  })();
}

function syncRow(db: Database.Database, input: SbomPullInput): SyncRow | undefined {
  return db.prepare<[string, string, string], SyncRow>(
    `SELECT accepted_generation_id, staging_generation_id,
            staging_continuation, staged_pages, staged_rows
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
  ).get(input.projectId, input.projectVersionId, ENTITY_KIND);
}

function startGeneration(
  db: Database.Database,
  input: SbomPullInput,
  generationId: string,
  startedAt: string,
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE pull_generation
          SET status = 'cancelled', completed_at = ?,
              error = 'Replaced by a fresh SBOM pull'
        WHERE project_id = ? AND project_version_id = ? AND status = 'staging'
          AND generation_id = (
            SELECT staging_generation_id FROM sync_state
             WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          )`,
    ).run(
      startedAt,
      input.projectId,
      input.projectVersionId,
      input.projectId,
      input.projectVersionId,
      ENTITY_KIND,
    );
    db.prepare(
      `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at)
       VALUES (?, ?, ?, 'staging', '["sbomComponent"]', ?)`,
    ).run(input.projectId, input.projectVersionId, generationId, startedAt);
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, staging_generation_id,
          staging_continuation, staged_pages, staged_rows, error)
       VALUES (?, ?, ?, ?, NULL, 0, 0, NULL)
       ON CONFLICT(project_id, project_version_id, entity_kind) DO UPDATE SET
         staging_generation_id = excluded.staging_generation_id,
         staging_continuation = NULL,
         staged_pages = 0,
         staged_rows = 0,
         error = NULL`,
    ).run(input.projectId, input.projectVersionId, ENTITY_KIND, generationId);
  })();
}

function stagePage(
  stage: Database.Database,
  components: NormalizedComponent[],
  continuation: string | null,
): StageMeta {
  return stage.transaction(() => {
    const insert = stage.prepare(
      `INSERT INTO components (
         component_id, component_key, purl, name, component_group, version,
         cpe, license, supplier, source, file_locations, is_stale, raw
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(component_id) DO UPDATE SET
         component_key = excluded.component_key,
         purl = excluded.purl,
         name = excluded.name,
         component_group = excluded.component_group,
         version = excluded.version,
         cpe = excluded.cpe,
         license = excluded.license,
         supplier = excluded.supplier,
         source = excluded.source,
         file_locations = excluded.file_locations,
         is_stale = excluded.is_stale,
         raw = excluded.raw`,
    );
    for (const component of components) {
      insert.run(
        component.componentId,
        component.componentKey,
        component.purl,
        component.name,
        component.group,
        component.version,
        component.cpe,
        component.license,
        component.supplier,
        component.source,
        component.fileLocations,
        component.isStale,
        component.raw,
      );
    }
    const rows = stage.prepare<[], { count: number }>(
      "SELECT COUNT(*) AS count FROM components",
    ).get()!.count;
    stage.prepare(
      `UPDATE meta SET continuation = ?, pages = pages + 1, rows = ?`,
    ).run(continuation, rows);
    return meta(stage)!;
  })();
}

function advanceSharedCursor(
  db: Database.Database,
  input: SbomPullInput,
  generationId: string,
  state: StageMeta,
): void {
  db.prepare(
    `UPDATE sync_state
        SET staging_continuation = ?, staged_pages = ?, staged_rows = ?
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
        AND staging_generation_id = ?`,
  ).run(
    state.continuation,
    state.pages,
    state.rows,
    input.projectId,
    input.projectVersionId,
    ENTITY_KIND,
    generationId,
  );
}

function safeFailure(error: unknown): { service: string; reason: string } {
  if (error instanceof RemoteError) return { service: error.service, reason: error.code };
  if (error instanceof SbomPullError) return { service: error.service, reason: error.code };
  return { service: "platform", reason: "SBOM_REFRESH_FAILED" };
}

function recordFailure(db: Database.Database, input: SbomPullInput, error: unknown): void {
  const failure = safeFailure(error);
  const service = failure.service === "assurance-studio" ? "Assurance Studio" : "Platform";
  const message = `${service} refresh failed (${failure.reason})`;
  db.transaction(() => {
    db.prepare(
      `UPDATE sync_state SET error = ?
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
    ).run(message, input.projectId, input.projectVersionId, ENTITY_KIND);
    db.prepare(
      `UPDATE pull_generation SET error = ?
        WHERE project_id = ? AND project_version_id = ? AND status = 'staging'
          AND generation_id = (
            SELECT staging_generation_id FROM sync_state
             WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          )`,
    ).run(
      message,
      input.projectId,
      input.projectVersionId,
      input.projectId,
      input.projectVersionId,
      ENTITY_KIND,
    );
    db.prepare(
      `UPDATE sbom_components SET is_stale = 1
        WHERE project_id = ? AND project_version_id = ?
          AND generation_id = (
            SELECT accepted_generation_id FROM sync_state
             WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          )`,
    ).run(
      input.projectId,
      input.projectVersionId,
      input.projectId,
      input.projectVersionId,
      ENTITY_KIND,
    );
  })();
}

function publishStage(
  deps: BomDeps,
  input: SbomPullInput,
  path: string,
  generationId: string,
  state: StageMeta,
  pulledAt: string,
): number {
  const alias = `bom_stage_${createHash("sha256").update(generationId).digest("hex").slice(0, 16)}`;
  deps.db.prepare(`ATTACH DATABASE ? AS ${alias}`).run(path);
  try {
    return deps.db.transaction(() => {
      deps.db.prepare(
        `DELETE FROM sbom_vuln_rollup
          WHERE project_id = ? AND project_version_id = ?`,
      ).run(input.projectId, input.projectVersionId);
      deps.db.prepare(
        `DELETE FROM sbom_components
          WHERE project_id = ? AND project_version_id = ?`,
      ).run(input.projectId, input.projectVersionId);
      deps.db.prepare(
        `INSERT INTO sbom_components (
           project_id, project_version_id, generation_id, component_id,
           component_key, purl, name, component_group, version, cpe, license,
           supplier, source, file_locations, is_stale, raw, pulled_at
         )
         SELECT ?, ?, ?, component_id, component_key, purl, name,
                component_group, version, cpe, license, supplier, source,
                file_locations, 0, raw, ?
           FROM ${alias}.components`,
      ).run(input.projectId, input.projectVersionId, generationId, pulledAt);
      const rollups = recomputeVulnRollup(deps.db, input.projectVersionId, {
        projectId: input.projectId,
        generationId,
        computedAt: pulledAt,
        warn: deps.warn,
      });
      deps.db.prepare(
        `UPDATE sync_state
            SET accepted_generation_id = ?, staging_generation_id = NULL,
                base_revision = base_revision + 1,
                staging_continuation = NULL, staged_pages = 0, staged_rows = 0,
                last_pull = ?, error = NULL
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND staging_generation_id = ?`,
      ).run(
        generationId,
        pulledAt,
        input.projectId,
        input.projectVersionId,
        ENTITY_KIND,
        generationId,
      );
      deps.db.prepare(
        `UPDATE pull_generation
            SET status = 'accepted', completed_at = ?, accepted_at = ?, error = NULL
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
      ).run(pulledAt, pulledAt, input.projectId, input.projectVersionId, generationId);
      return rollups;
    })();
  } finally {
    deps.db.exec(`DETACH DATABASE ${alias}`);
  }
}

export async function pullSbom(
  deps: BomDeps,
  input: SbomPullInput,
): Promise<SbomPullResult> {
  if (!input.projectId || !input.projectVersionId) {
    throw new SbomPullError("SBOM_SCOPE_REQUIRED", "Project and project version are required");
  }
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
    throw new SbomPullError("SBOM_PAGE_SIZE_INVALID", "SBOM page size must be between 1 and 200");
  }
  const path = stagingPath(deps.worktreeRoot, input);
  let resumed = false;
  let generationId: string;
  let stage: Database.Database;
  const current = syncRow(deps.db, input);

  if (input.resume && current?.staging_generation_id && existsSync(path)) {
    stage = openStage(path);
    const saved = meta(stage);
    if (
      saved?.project_id === input.projectId &&
      saved.project_version_id === input.projectVersionId &&
      saved.generation_id === current.staging_generation_id &&
      saved.continuation === current.staging_continuation &&
      saved.pages === current.staged_pages &&
      saved.rows === current.staged_rows
    ) {
      generationId = saved.generation_id;
      resumed = true;
    } else {
      stage.close();
      throw new SbomPullError("SBOM_RESUME_STATE_MISMATCH", "Stored SBOM resume state is inconsistent");
    }
  } else {
    removeStage(path);
    stage = openStage(path);
    generationId = deps.generationId?.() ?? randomUUID();
    initializeStage(stage, input, generationId);
    startGeneration(deps.db, input, generationId, (deps.now?.() ?? new Date()).toISOString());
  }

  try {
    let state = meta(stage)!;
    const initialPhase = decodePhase(state.continuation);
    for (const excluded of initialPhase.excluded ? [true] : [false, true]) {
      const remoteContinuation = excluded === initialPhase.excluded
        ? initialPhase.remoteContinuation
        : null;
      const pages = deps.platform.listComponents(
        {
          excluded,
          page: {
            pageSize,
            ...(remoteContinuation ? { continuation: remoteContinuation } : {}),
          },
        },
        deps.signal ? { signal: deps.signal } : undefined,
      );
      for await (const page of pages) {
        if (deps.signal?.aborted) {
          throw new SbomPullError("SBOM_PULL_CANCELLED", "SBOM refresh was cancelled");
        }
        const normalized = page.items.map(normalizeComponent);
        const next = page.next === null
          ? excluded ? null : encodePhase({ excluded: true, remoteContinuation: null })
          : encodePhase({ excluded, remoteContinuation: page.next });
        state = stagePage(stage, normalized, next);
        advanceSharedCursor(deps.db, input, generationId, state);
        deps.publishProgress?.({
          projectVersionId: input.projectVersionId,
          components: state.rows,
          pages: state.pages,
        });
      }
    }
    if (state.continuation !== null) {
      throw new SbomPullError("SBOM_STREAM_INCOMPLETE", "Platform component stream ended before its final page");
    }
    stage.close();
    const pulledAt = (deps.now?.() ?? new Date()).toISOString();
    const rollups = publishStage(deps, input, path, generationId, state, pulledAt);
    removeStage(path);
    deps.publishChanged?.({ projectVersionId: input.projectVersionId });
    return {
      projectVersionId: input.projectVersionId,
      components: state.rows,
      pages: state.pages,
      rollups,
      pulledAt,
      resumed,
    };
  } catch (error) {
    if (stage.open) stage.close();
    recordFailure(deps.db, input, error);
    throw error;
  }
}
