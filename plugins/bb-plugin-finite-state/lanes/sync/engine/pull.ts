import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type Database from "better-sqlite3";

import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { RemoteError } from "../../../lib/remote/types.js";
import { entryFor, type EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../serialize/canonical.js";
import { BaseSnapshotStore, type BaseRow } from "../store/base-snapshot.js";
import {
  registeredCachePullers,
  registeredPullAdapters,
  type AdapterAdvisory,
  type CachePuller,
  type EntityAdapter,
  type ServerEntity,
  type SyncScope,
  type WorkingEntity,
} from "./adapter.js";
import { diagnoseRemoteFailure } from "../../../lib/remote/errors.js";

const execFileAsync = promisify(execFile);

/** Tiny realtime hint emitted on `fs-sync-pull`; entity data is never published. */
export interface PullProgress {
  scope: SyncScope;
  generationId: string;
  kind: EntityKind;
  page: number;
  of: number | null;
  phase: "fetch" | "write" | "done";
}

/** Accepted generation metadata exposed only after the atomic pointer flip commits. */
export interface PullPublication {
  scope: SyncScope;
  generationId: string;
  acceptedAt: string;
  kinds: readonly EntityKind[];
}

/** Dependencies owned by the server registration root and injected into the engine. */
export interface EngineDeps {
  /** Migrated plugin SQLite database. */
  db: Database.Database;
  /** Worktree used for authored-file status, or `null` when no workspace is available. */
  worktreeRoot?: string | null;
  /** Optional realtime publisher. */
  publish?(channel: "fs-sync-pull", progress: PullProgress): void;
  /** Optional post-commit invalidation seam owned by sync registration. */
  published?(publication: PullPublication): void;
  /** Clock seam for deterministic tests. */
  now?(): Date;
  /** Generation-id seam for deterministic tests. */
  createGenerationId?(): string;
  /** Adapter override used by isolated engine consumers; registered adapters are the default. */
  adapters?: readonly EntityAdapter[];
  /** Cache-puller override used by isolated engine consumers; registered pullers are the default. */
  cachePullers?: readonly Readonly<{ kind: EntityKind; pull: CachePuller }>[];
  /** Per-file git cleanliness seam. */
  isFileClean?(worktreeRoot: string, relativeFile: string): Promise<boolean>;
  /**
   * Optional post-publication writer for clean authored files. The engine
   * supplies only accepted semantic rows; the owning surface preserves its
   * document shape and bookkeeping fields.
   */
  fastForwardWorking?(
    input: Readonly<{
      scope: SyncScope;
      generationId: string;
      adapter: EntityAdapter;
      files: readonly string[];
      baseRows: readonly BaseRow[];
      worktreeRoot: string;
    }>,
  ): Promise<void>;
}

/** Successful atomic pull publication report. */
export interface PullReport {
  generationId: string;
  acceptedAt: string;
  kinds: Record<
    string,
    { fetched: number; baseRows: number; quarantined: number }
  >;
  workingFastForwarded: boolean;
  divergence: string[];
  advisories: Array<{ kind: EntityKind; code: string; count: number }>;
}

export interface PullProjectBinding {
  assuranceStudioProjectId: string | null;
}

export function remoteScopeForKind(
  kind: EntityKind,
  scope: SyncScope,
  binding: PullProjectBinding,
): SyncScope {
  const entry = entryFor(kind);
  if (!("server" in entry) || entry.server !== "assurance-studio") {
    return scope;
  }
  if (binding.assuranceStudioProjectId === null) {
    throw new Error(
      `AS_PROJECT_SELECTION_REQUIRED: select an Assurance Studio project before reading ${kind}`,
    );
  }
  return { ...scope, projectId: binding.assuranceStudioProjectId };
}

/** Typed upstream-data failure that prevents raw SQLite constraints escaping. */
export class PullDataError extends Error {
  /** Creates a safe data diagnostic for a kind and stable key. */
  constructor(
    readonly kind: EntityKind,
    readonly key: string,
    message: string,
  ) {
    super(`${kind}/${key}: ${message}`);
    this.name = "PullDataError";
  }
}

/** Failure after the engine has isolated and checkpointed every requested kind it could process. */
export class PullFailedError extends Error {
  /** Creates an aggregate failure while preserving the resumable staging generation. */
  constructor(
    readonly generationId: string,
    readonly failures: readonly Readonly<{
      kind: EntityKind;
      message: string;
    }>[],
  ) {
    super(
      `Pull generation ${generationId} did not publish: ${failures.map((item) => `${item.kind}: ${item.message}`).join("; ")}`,
    );
    this.name = "PullFailedError";
  }

  /** Safe presentation for frozen RPC error channels; CLI keeps the rich message. */
  get contractSafeMessage(): string {
    return `Pull generation ${this.generationId} did not publish: ${this.failures
      .map((item) => {
        const remoteCode = /\b(REMOTE_[A-Z0-9_]+):/u.exec(item.message)?.[1];
        return `${item.kind}: ${remoteCode === undefined ? item.message : `${remoteCode}: remote request failed`}`;
      })
      .join("; ")}`;
  }
}

/** A kind failure whose staged generation must not be resumed. */
export class TerminalPullError extends Error {
  constructor(cause: Error) {
    super(cause.message, { cause });
    this.name = "TerminalPullError";
  }
}

interface StagingState {
  generationId: string;
  stagedPages: number;
  stagedRows: number;
}

interface ExistingStagingRow {
  entityKey: string;
  remoteId: string | null;
  payloadJson: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWorkingEntity(value: unknown): value is WorkingEntity {
  return (
    isRecord(value) &&
    typeof value["key"] === "string" &&
    isRecord(value["payload"]) &&
    typeof value["file"] === "string"
  );
}

function isWorkingReadIssue(value: unknown): value is { file: string } {
  return isRecord(value) && typeof value["file"] === "string";
}

function partialWorkingRead(error: unknown): {
  working: WorkingEntity[];
  errorFiles: string[];
} | null {
  if (!isRecord(error)) return null;
  const working = error["partialWorking"];
  const issues = error["issues"];
  if (
    !Array.isArray(working) ||
    !working.every(isWorkingEntity) ||
    !Array.isArray(issues) ||
    !issues.every(isWorkingReadIssue)
  ) {
    return null;
  }
  return {
    working,
    errorFiles: issues.map((issue) => issue.file),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof RemoteError)
    return `${error.code}: ${diagnoseRemoteFailure(error).message}`;
  return error instanceof Error ? error.message : String(error);
}

function storedErrorMessage(error: unknown): string {
  return error instanceof RemoteError
    ? `${error.code}: remote request failed`
    : errorMessage(error);
}

function sqliteConstraint(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error["code"] === "string" &&
    error["code"].startsWith("SQLITE_CONSTRAINT")
  );
}

function nowIso(deps: EngineDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function requestedAdapters(
  deps: EngineDeps,
  kinds: readonly EntityKind[] | undefined,
): EntityAdapter[] {
  const requested = kinds === undefined ? null : new Set(kinds);
  return [...(deps.adapters ?? registeredPullAdapters(kinds))]
    .filter((adapter) => requested === null || requested.has(adapter.kind))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function requestedCachePullers(
  deps: EngineDeps,
  kinds: readonly EntityKind[] | undefined,
): Array<Readonly<{ kind: EntityKind; pull: CachePuller }>> {
  const requested = kinds === undefined ? null : new Set(kinds);
  return [...(deps.cachePullers ?? registeredCachePullers())]
    .filter((entry) => requested === null || requested.has(entry.kind))
    .sort((left, right) => left.kind.localeCompare(right.kind));
}

function assertSelection(
  kinds: readonly EntityKind[] | undefined,
  adapters: readonly EntityAdapter[],
  cachePullers: readonly Readonly<{ kind: EntityKind }>[],
): EntityKind[] {
  const available = new Set<EntityKind>([
    ...adapters.map((adapter) => adapter.kind),
    ...cachePullers.map((entry) => entry.kind),
  ]);
  if (kinds !== undefined) {
    const missing = kinds.find((kind) => !available.has(kind));
    if (missing !== undefined)
      throw new Error(`No puller is registered for ${missing}`);
  }
  const selected = [...available].sort((left, right) =>
    left.localeCompare(right),
  );
  if (selected.length === 0)
    throw new Error("No sync adapters or cache pullers are registered");
  return selected;
}

function stagingState(
  db: Database.Database,
  scope: SyncScope,
  storageVersionId: string,
  requestedKindsJson: string,
  kinds: readonly EntityKind[],
): StagingState | null {
  const generation = db
    .prepare(
      `SELECT generation_id
       FROM pull_generation
      WHERE project_id = ? AND project_version_id = ? AND status = 'staging'
        AND requested_kinds_json = ?
      ORDER BY started_at DESC, generation_id DESC
      LIMIT 1`,
    )
    .get(scope.projectId, storageVersionId, requestedKindsJson);
  if (!isRecord(generation) || typeof generation["generation_id"] !== "string")
    return null;
  const generationId = generation["generation_id"];
  let stagedPages = 0;
  let stagedRows = 0;
  for (const kind of kinds) {
    const state = db
      .prepare(
        `SELECT staging_generation_id, staged_pages, staged_rows
         FROM sync_state
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
      )
      .get(scope.projectId, storageVersionId, kind);
    if (
      !isRecord(state) ||
      state["staging_generation_id"] !== generationId ||
      typeof state["staged_pages"] !== "number" ||
      typeof state["staged_rows"] !== "number"
    ) {
      return null;
    }
    stagedPages += state["staged_pages"];
    stagedRows += state["staged_rows"];
  }
  return { generationId, stagedPages, stagedRows };
}

function beginGeneration(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
  kinds: readonly EntityKind[],
): string {
  const requestedKindsJson = canonicalJson(kinds);
  const resumable = stagingState(
    deps.db,
    scope,
    storageVersionId,
    requestedKindsJson,
    kinds,
  );
  if (resumable !== null) return resumable.generationId;

  const generationId = (deps.createGenerationId ?? randomUUID)();
  if (generationId.trim().length === 0)
    throw new Error("Pull generation id must not be empty");
  const startedAt = nowIso(deps);
  deps.db.transaction(() => {
    const superseded = new Set<string>();
    for (const kind of kinds) {
      const row = deps.db
        .prepare(
          `SELECT staging_generation_id
           FROM sync_state
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
        )
        .get(scope.projectId, storageVersionId, kind);
      if (isRecord(row) && typeof row["staging_generation_id"] === "string") {
        superseded.add(row["staging_generation_id"]);
      }
    }
    for (const previousGenerationId of superseded) {
      deps.db
        .prepare(
          `UPDATE pull_generation
            SET status = 'superseded', completed_at = ?
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            AND status = 'staging'`,
        )
        .run(
          startedAt,
          scope.projectId,
          storageVersionId,
          previousGenerationId,
        );
      deps.db
        .prepare(
          `UPDATE sync_state
            SET staging_generation_id = NULL, staging_continuation = NULL,
                staged_pages = 0, staged_rows = 0, staged_quarantined = 0
          WHERE project_id = ? AND project_version_id = ?
            AND staging_generation_id = ?`,
        )
        .run(scope.projectId, storageVersionId, previousGenerationId);
      deps.db
        .prepare(
          `DELETE FROM base_snapshot
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
        )
        .run(scope.projectId, storageVersionId, previousGenerationId);
    }
    deps.db
      .prepare(
        `INSERT INTO pull_generation
         (project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at, completed_at, accepted_at, error)
       VALUES (?, ?, ?, 'staging', ?, ?, NULL, NULL, NULL)`,
      )
      .run(
        scope.projectId,
        storageVersionId,
        generationId,
        requestedKindsJson,
        startedAt,
      );
    const upsert = deps.db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          staging_generation_id, base_revision, staging_continuation,
          staged_pages, staged_rows, last_pull, error)
       VALUES (?, ?, ?, NULL, ?, 0, NULL, 0, 0, NULL, NULL)
         ON CONFLICT (project_id, project_version_id, entity_kind) DO UPDATE SET
         staging_generation_id = excluded.staging_generation_id,
         staging_continuation = NULL,
         staged_pages = 0,
         staged_rows = 0,
         staged_quarantined = 0,
         error = NULL`,
    );
    for (const kind of kinds)
      upsert.run(scope.projectId, storageVersionId, kind, generationId);
  })();
  return generationId;
}

function kindCheckpoint(
  db: Database.Database,
  scope: SyncScope,
  storageVersionId: string,
  kind: EntityKind,
  generationId: string,
): { pages: number; rows: number; quarantined: number } {
  const value = db
    .prepare(
      `SELECT staged_pages, staged_rows, staged_quarantined
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
        AND staging_generation_id = ?`,
    )
    .get(scope.projectId, storageVersionId, kind, generationId);
  if (
    !isRecord(value) ||
    typeof value["staged_pages"] !== "number" ||
    typeof value["staged_rows"] !== "number" ||
    typeof value["staged_quarantined"] !== "number"
  ) {
    throw new Error(`Staging fence moved for ${kind}`);
  }
  return {
    pages: value["staged_pages"],
    rows: value["staged_rows"],
    quarantined: value["staged_quarantined"],
  };
}

function existingStagingRows(
  db: Database.Database,
  scope: SyncScope,
  storageVersionId: string,
  kind: EntityKind,
  generationId: string,
  entityKeys: readonly string[],
): Map<string, ExistingStagingRow> {
  const keys = [...new Set(entityKeys)];
  if (keys.length === 0) return new Map();
  const placeholders = keys.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT entity_key, remote_id, payload
       FROM base_snapshot
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
        AND generation_id = ? AND entity_key IN (${placeholders})`,
    )
    .all(scope.projectId, storageVersionId, kind, generationId, ...keys);
  const result = new Map<string, ExistingStagingRow>();
  for (const row of rows) {
    if (
      !isRecord(row) ||
      typeof row["entity_key"] !== "string" ||
      (row["remote_id"] !== null && typeof row["remote_id"] !== "string") ||
      typeof row["payload"] !== "string"
    ) {
      throw new Error(`Corrupt staging row for ${kind}`);
    }
    result.set(row["entity_key"], {
      entityKey: row["entity_key"],
      remoteId: row["remote_id"],
      payloadJson: row["payload"],
    });
  }
  return result;
}

function uniquePage(
  adapter: EntityAdapter,
  page: readonly ServerEntity[],
  existing: ReadonlyMap<string, ExistingStagingRow>,
): ServerEntity[] {
  const unique = new Map<string, ServerEntity>();
  const remoteOwners = new Map<string, string>();
  for (const row of existing.values()) {
    if (row.remoteId !== null) remoteOwners.set(row.remoteId, row.entityKey);
  }
  for (const entity of page) {
    const semantic = {
      ...entity,
      payload: adapter.serializer.semanticPayload(entity.payload),
    };
    const payloadJson = canonicalJson(semantic.payload);
    const prior = unique.get(semantic.key);
    const persisted = existing.get(semantic.key);
    if (prior !== undefined) {
      if (
        prior.remoteId !== semantic.remoteId ||
        canonicalJson(prior.payload) !== payloadJson
      ) {
        throw new PullDataError(
          adapter.kind,
          semantic.key,
          "remote page contains conflicting duplicate keys",
        );
      }
      continue;
    }
    if (persisted !== undefined) {
      if (
        persisted.remoteId !== semantic.remoteId ||
        persisted.payloadJson !== payloadJson
      ) {
        throw new PullDataError(
          adapter.kind,
          semantic.key,
          "remote pages disagree about one stable key",
        );
      }
      continue;
    }
    if (semantic.remoteId !== null) {
      const owner = remoteOwners.get(semantic.remoteId);
      if (owner !== undefined && owner !== semantic.key) {
        throw new PullDataError(
          adapter.kind,
          semantic.key,
          `remote id is already claimed by ${owner}`,
        );
      }
      remoteOwners.set(semantic.remoteId, semantic.key);
    }
    unique.set(semantic.key, semantic);
  }
  return [...unique.values()];
}

function writePage(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
  adapter: EntityAdapter,
  generationId: string,
  pageNumber: number,
  entities: readonly ServerEntity[],
  quarantined: number,
): number {
  const existing = existingStagingRows(
    deps.db,
    scope,
    storageVersionId,
    adapter.kind,
    generationId,
    entities.map((entity) => entity.key),
  );
  const unique = uniquePage(adapter, entities, existing);
  const pulledAt = nowIso(deps);
  const rows: BaseRow[] = unique.map((entity) => ({
    projectId: scope.projectId,
    projectVersionId: storageVersionId,
    entityKind: adapter.kind,
    generationId,
    entityKey: entity.key,
    remoteId: entity.remoteId,
    payload: entity.payload,
    contentHash: "",
    pulledAt,
  }));
  try {
    deps.db.transaction(() => {
      new BaseSnapshotStore(deps.db).putStagingPage(
        scope.projectId,
        storageVersionId,
        adapter.kind,
        generationId,
        rows,
      );
      const updated = deps.db
        .prepare(
          `UPDATE sync_state
            SET staging_continuation = ?, staged_pages = ?,
                staged_rows = staged_rows + ?,
                staged_quarantined = staged_quarantined + ?, error = NULL
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND staging_generation_id = ? AND staged_pages = ?`,
        )
        .run(
          String(pageNumber),
          pageNumber,
          rows.length,
          quarantined,
          scope.projectId,
          storageVersionId,
          adapter.kind,
          generationId,
          pageNumber - 1,
        );
      if (updated.changes !== 1)
        throw new Error(`Staging checkpoint moved for ${adapter.kind}`);
    })();
  } catch (error: unknown) {
    if (sqliteConstraint(error)) {
      throw new PullDataError(
        adapter.kind,
        "remote-page",
        "remote identifiers violate stable-key uniqueness",
      );
    }
    throw error;
  }
  return rows.length;
}

async function pullAdapter(
  deps: EngineDeps,
  scope: SyncScope,
  remoteScope: SyncScope,
  storageVersionId: string,
  adapter: EntityAdapter,
  generationId: string,
  onAdvisory: (advisory: AdapterAdvisory, count: number) => void,
): Promise<{ fetched: number; baseRows: number; quarantined: number }> {
  const checkpoint = kindCheckpoint(
    deps.db,
    scope,
    storageVersionId,
    adapter.kind,
    generationId,
  );
  let pageNumber = 0;
  let latestOf: number | null = null;
  const fetchedKeys = new Set<string>();
  let quarantined = checkpoint.quarantined;
  let pendingAdvisories = new Map<string, number>();
  if (adapter.kind === "vexDecision" && checkpoint.quarantined > 0) {
    onAdvisory({ code: "VEX_REMOTE_IDENTITY_MISSING" }, checkpoint.quarantined);
  }
  const pages = adapter.fetchRemote(
    remoteScope,
    (progress) => {
      latestOf = progress.of;
      deps.publish?.("fs-sync-pull", {
        scope,
        generationId,
        kind: adapter.kind,
        ...progress,
        phase: "fetch",
      });
    },
    (advisory) => {
      pendingAdvisories.set(
        advisory.code,
        (pendingAdvisories.get(advisory.code) ?? 0) + 1,
      );
    },
  );
  for await (const page of pages) {
    pageNumber += 1;
    for (const entity of page) fetchedKeys.add(entity.key);
    const pageAdvisories = pendingAdvisories;
    pendingAdvisories = new Map();
    if (pageNumber <= checkpoint.pages) {
      const unseen = uniquePage(
        adapter,
        page,
        existingStagingRows(
          deps.db,
          scope,
          storageVersionId,
          adapter.kind,
          generationId,
          page.map((entity) => entity.key),
        ),
      );
      if (unseen.length > 0) {
        throw new PullDataError(
          adapter.kind,
          "resumed-page",
          "remote page changed after its checkpoint",
        );
      }
      continue;
    }
    const pageQuarantined =
      adapter.kind === "vexDecision"
        ? (pageAdvisories.get("VEX_REMOTE_IDENTITY_MISSING") ?? 0)
        : 0;
    writePage(
      deps,
      scope,
      storageVersionId,
      adapter,
      generationId,
      pageNumber,
      page,
      pageQuarantined,
    );
    quarantined += pageQuarantined;
    for (const [code, count] of pageAdvisories) {
      onAdvisory({ code }, count);
    }
    deps.publish?.("fs-sync-pull", {
      scope,
      generationId,
      kind: adapter.kind,
      page: pageNumber,
      of: latestOf,
      phase: "write",
    });
  }
  if (pageNumber < checkpoint.pages) {
    throw new Error(
      `Remote stream for ${adapter.kind} ended before staged page ${checkpoint.pages}`,
    );
  }
  if (pendingAdvisories.size > 0) {
    throw new Error(
      `${adapter.kind} reported advisories outside a remote page`,
    );
  }
  const count = deps.db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM base_snapshot
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
        AND generation_id = ?`,
    )
    .get(scope.projectId, storageVersionId, adapter.kind, generationId);
  if (!isRecord(count) || typeof count["count"] !== "number") {
    throw new Error(`Could not count staged ${adapter.kind} rows`);
  }
  deps.publish?.("fs-sync-pull", {
    scope,
    generationId,
    kind: adapter.kind,
    page: pageNumber,
    of: latestOf,
    phase: "done",
  });
  return {
    fetched: fetchedKeys.size,
    baseRows: count["count"],
    quarantined,
  };
}

async function defaultFileClean(root: string, file: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--", file],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

async function workingState(
  deps: EngineDeps,
  scope: SyncScope,
  adapters: readonly EntityAdapter[],
): Promise<{
  divergence: string[];
  cleanFiles: ReadonlyMap<EntityKind, readonly string[]>;
}> {
  const root = deps.worktreeRoot;
  if (root === undefined || root === null) {
    return { divergence: [], cleanFiles: new Map() };
  }
  const divergence: string[] = [];
  const cleanFiles = new Map<EntityKind, readonly string[]>();
  const isClean = deps.isFileClean ?? defaultFileClean;
  for (const adapter of adapters) {
    let working;
    try {
      working = await adapter.readWorking(root, scope);
    } catch (error: unknown) {
      const partial = partialWorkingRead(error);
      if (partial === null) {
        divergence.push(`${adapter.kind}/read-error`);
        continue;
      }
      working = partial.working;
      for (const file of partial.errorFiles) {
        divergence.push(`${adapter.kind}/${file}/read-error`);
      }
    }
    const clean = new Set<string>();
    for (const entity of working) {
      if (await isClean(root, entity.file)) clean.add(entity.file);
      else divergence.push(`${adapter.kind}/${entity.key}`);
    }
    cleanFiles.set(
      adapter.kind,
      [...clean].sort((left, right) => left.localeCompare(right)),
    );
  }
  divergence.sort((left, right) => left.localeCompare(right));
  return { divergence, cleanFiles };
}

async function fastForwardWorking(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
  generationId: string,
  adapters: readonly EntityAdapter[],
  working: Awaited<ReturnType<typeof workingState>>,
): Promise<{ workingFastForwarded: boolean; divergence: string[] }> {
  const divergence = [...working.divergence];
  const root = deps.worktreeRoot;
  if (root === undefined || root === null) {
    return { workingFastForwarded: false, divergence };
  }
  for (const adapter of adapters) {
    const files = working.cleanFiles.get(adapter.kind) ?? [];
    if (files.length === 0) continue;
    if (deps.fastForwardWorking === undefined) {
      divergence.push(`${adapter.kind}/fast-forward-unavailable`);
      continue;
    }
    try {
      await deps.fastForwardWorking({
        scope,
        generationId,
        adapter,
        files,
        baseRows: new BaseSnapshotStore(deps.db).listAccepted(
          scope.projectId,
          storageVersionId,
          adapter.kind,
        ),
        worktreeRoot: root,
      });
    } catch {
      divergence.push(`${adapter.kind}/fast-forward-error`);
    }
  }
  divergence.sort((left, right) => left.localeCompare(right));
  return { workingFastForwarded: divergence.length === 0, divergence };
}

function recordKindFailure(
  db: Database.Database,
  scope: SyncScope,
  storageVersionId: string,
  generationId: string,
  kind: EntityKind,
  message: string,
  terminal: boolean,
): void {
  db.transaction(() => {
    db.prepare(
      `UPDATE sync_state SET error = ?
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          AND staging_generation_id = ?`,
    ).run(
      message.slice(0, 2_000),
      scope.projectId,
      storageVersionId,
      kind,
      generationId,
    );
    db.prepare(
      `UPDATE pull_generation
          SET status = CASE WHEN ? THEN 'failed' ELSE status END,
              error = ?
        WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
          AND status IN ('staging', 'failed')`,
    ).run(
      terminal ? 1 : 0,
      `${kind}: ${message}`.slice(0, 2_000),
      scope.projectId,
      storageVersionId,
      generationId,
    );
  })();
}

function publishGeneration(
  deps: EngineDeps,
  scope: SyncScope,
  storageVersionId: string,
  generationId: string,
  kinds: readonly EntityKind[],
): string {
  const acceptedAt = nowIso(deps);
  deps.db.transaction(() => {
    const updateState = deps.db.prepare(
      `UPDATE sync_state
          SET accepted_generation_id = ?, staging_generation_id = NULL,
              base_revision = base_revision + 1, staging_continuation = NULL,
              staged_pages = 0, staged_rows = 0, staged_quarantined = 0,
              last_pull = ?, error = NULL
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
          AND staging_generation_id = ?`,
    );
    for (const kind of kinds) {
      const result = updateState.run(
        generationId,
        acceptedAt,
        scope.projectId,
        storageVersionId,
        kind,
        generationId,
      );
      if (result.changes !== 1)
        throw new Error(`Publication fence moved for ${kind}`);
    }
    const accepted = deps.db
      .prepare(
        `UPDATE pull_generation
          SET status = 'accepted', completed_at = ?, accepted_at = ?, error = NULL
        WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
          AND status = 'staging'`,
      )
      .run(
        acceptedAt,
        acceptedAt,
        scope.projectId,
        storageVersionId,
        generationId,
      );
    if (accepted.changes !== 1)
      throw new Error(`Publication generation fence moved for ${generationId}`);
    // Base rows are machinery, not history: retain only rows referenced by
    // the current accepted or active staging pointer for their own kind.
    deps.db
      .prepare(
        `DELETE FROM base_snapshot
        WHERE project_id = ? AND project_version_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM sync_state AS state
             WHERE state.project_id = base_snapshot.project_id
               AND state.project_version_id = base_snapshot.project_version_id
               AND state.entity_kind = base_snapshot.entity_kind
               AND (
                 state.accepted_generation_id = base_snapshot.generation_id
                 OR state.staging_generation_id = base_snapshot.generation_id
               )
          )`,
      )
      .run(scope.projectId, storageVersionId);
    deps.db
      .prepare(
        `UPDATE pull_generation AS generation
          SET status = 'superseded'
        WHERE generation.project_id = ? AND generation.project_version_id = ?
          AND generation.status = 'accepted' AND generation.generation_id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM sync_state AS state
             WHERE state.project_id = generation.project_id
               AND state.project_version_id = generation.project_version_id
               AND state.accepted_generation_id = generation.generation_id
          )`,
      )
      .run(scope.projectId, storageVersionId, generationId);
  })();
  return acceptedAt;
}

/**
 * Pulls every selected adapter page into staging, then atomically publishes
 * the generation. A failed kind is recorded and isolated; no partial
 * generation becomes visible. Retryable failures resume after whole pages,
 * while terminal failures start a fresh generation on the next call.
 */
export async function pull(
  deps: EngineDeps,
  scope: SyncScope,
  kinds?: EntityKind[],
  binding: PullProjectBinding = { assuranceStudioProjectId: null },
): Promise<PullReport> {
  if (scope.projectId.trim().length === 0)
    throw new Error("projectId must not be empty");
  const adapters = requestedAdapters(deps, kinds);
  const cachePullers = requestedCachePullers(deps, kinds);
  const selectedKinds = assertSelection(kinds, adapters, cachePullers);
  for (const kind of selectedKinds) remoteScopeForKind(kind, scope, binding);
  const storageVersionId = toStorageProjectVersionId(scope.projectVersionId);
  const generationId = beginGeneration(
    deps,
    scope,
    storageVersionId,
    selectedKinds,
  );
  const reportKinds: PullReport["kinds"] = {};
  const advisoryCounts = new Map<string, PullReport["advisories"][number]>();
  const failures: Array<{ kind: EntityKind; message: string }> = [];

  for (const adapter of adapters) {
    try {
      const remoteScope = remoteScopeForKind(adapter.kind, scope, binding);
      reportKinds[adapter.kind] = await pullAdapter(
        deps,
        scope,
        remoteScope,
        storageVersionId,
        adapter,
        generationId,
        (advisory, count) => {
          const key = `${adapter.kind}\0${advisory.code}`;
          const current = advisoryCounts.get(key);
          advisoryCounts.set(key, {
            kind: adapter.kind,
            code: advisory.code,
            count: (current?.count ?? 0) + count,
          });
        },
      );
    } catch (error: unknown) {
      const message = errorMessage(error);
      failures.push({ kind: adapter.kind, message });
      recordKindFailure(
        deps.db,
        scope,
        storageVersionId,
        generationId,
        adapter.kind,
        storedErrorMessage(error),
        error instanceof TerminalPullError,
      );
    }
  }
  for (const cache of cachePullers) {
    try {
      const cacheReport = await cache.pull(scope, generationId, (progress) => {
        deps.publish?.("fs-sync-pull", {
          scope,
          generationId,
          kind: cache.kind,
          ...progress,
          phase: "fetch",
        });
      });
      const staged = deps.db
        .prepare(
          `SELECT staged_rows, staged_quarantined
           FROM sync_state
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND staging_generation_id = ?`,
        )
        .get(scope.projectId, storageVersionId, cache.kind, generationId);
      if (
        !isRecord(staged) ||
        typeof staged["staged_rows"] !== "number" ||
        typeof staged["staged_quarantined"] !== "number"
      ) {
        throw new Error(`Could not count staged ${cache.kind} rows`);
      }
      if (cacheReport.baseRows !== staged["staged_rows"]) {
        throw new Error(
          `Cache puller reported an invalid ${cache.kind} publication count`,
        );
      }
      if (cacheReport.quarantined !== staged["staged_quarantined"]) {
        throw new Error(
          `Cache puller reported an invalid ${cache.kind} quarantine count`,
        );
      }
      for (const advisory of cacheReport.advisories) {
        if (
          advisory.code.length === 0 ||
          !Number.isSafeInteger(advisory.count) ||
          advisory.count <= 0
        ) {
          throw new Error(
            `Cache puller reported an invalid ${cache.kind} advisory`,
          );
        }
        const key = `${cache.kind}\0${advisory.code}`;
        const current = advisoryCounts.get(key);
        advisoryCounts.set(key, {
          kind: cache.kind,
          code: advisory.code,
          count: (current?.count ?? 0) + advisory.count,
        });
      }
      // `fetched` is work performed now. The generation checkpoint is the
      // authority for complete publication and quarantine totals across
      // every invocation that contributed to this generation.
      reportKinds[cache.kind] = {
        fetched: cacheReport.fetched,
        baseRows: staged["staged_rows"],
        quarantined: staged["staged_quarantined"],
      };
      deps.publish?.("fs-sync-pull", {
        scope,
        generationId,
        kind: cache.kind,
        page: 0,
        of: null,
        phase: "done",
      });
    } catch (error: unknown) {
      const message = errorMessage(error);
      failures.push({ kind: cache.kind, message });
      recordKindFailure(
        deps.db,
        scope,
        storageVersionId,
        generationId,
        cache.kind,
        storedErrorMessage(error),
        error instanceof TerminalPullError,
      );
    }
  }
  if (failures.length > 0) throw new PullFailedError(generationId, failures);

  if (deps.worktreeRoot !== null && deps.worktreeRoot !== undefined) {
    for (const adapter of adapters) {
      await adapter.migrateWorkingKeys?.(deps.worktreeRoot, scope);
    }
  }

  const working = await workingState(deps, scope, adapters);
  const acceptedAt = publishGeneration(
    deps,
    scope,
    storageVersionId,
    generationId,
    selectedKinds,
  );
  deps.published?.({
    scope,
    generationId,
    acceptedAt,
    kinds: selectedKinds,
  });
  const fastForward = await fastForwardWorking(
    deps,
    scope,
    storageVersionId,
    generationId,
    adapters,
    working,
  );
  return {
    generationId,
    acceptedAt,
    kinds: reportKinds,
    workingFastForwarded: fastForward.workingFastForwarded,
    divergence: fastForward.divergence,
    advisories: [...advisoryCounts.values()].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.code.localeCompare(right.code),
    ),
  };
}
