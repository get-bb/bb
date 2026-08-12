import type Database from "better-sqlite3";

import type { EntityKind } from "../../../lib/sync/registry.js";
import { canonicalJson } from "../serialize/canonical.js";
import { createSerializer } from "../serialize/serializer.js";

export interface BaseRow {
  projectId: string;
  projectVersionId: string;
  entityKind: EntityKind;
  generationId: string;
  entityKey: string;
  remoteId: string | null;
  payload: Record<string, unknown>;
  contentHash: string;
  pulledAt: string;
}

export class BaseSnapshotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseSnapshotInputError";
  }
}

export class BaseSnapshotFenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaseSnapshotFenceError";
  }
}

export class BaseSnapshotCorruptRowError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BaseSnapshotCorruptRowError";
  }
}

interface PreparedBaseRow extends BaseRow {
  payloadJson: string;
}

interface SyncState {
  acceptedGenerationId: string | null;
  stagingGenerationId: string | null;
  baseRevision: number;
}

const HASH_OPTIONS = {
  idToSlug: (_remoteId: string): null => null,
  onWarning: (): void => undefined,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) {
    throw new BaseSnapshotInputError(`${label} must not be empty`);
  }
}

function assertRemoteId(value: string | null, label: string): void {
  if (value !== null) assertNonEmpty(value, label);
}

function assertPayload(payload: Record<string, unknown>): void {
  if (!isRecord(payload)) {
    throw new BaseSnapshotInputError("payload must be a JSON object");
  }
}

function semanticContentHash(
  kind: EntityKind,
  payload: Record<string, unknown>,
): string {
  return createSerializer(kind).contentHash(payload, HASH_OPTIONS);
}

function prepareRow(row: BaseRow): PreparedBaseRow {
  assertNonEmpty(row.projectId, "row.projectId");
  assertNonEmpty(row.projectVersionId, "row.projectVersionId");
  assertNonEmpty(row.generationId, "row.generationId");
  assertNonEmpty(row.entityKey, "row.entityKey");
  assertRemoteId(row.remoteId, "row.remoteId");
  assertNonEmpty(row.pulledAt, "row.pulledAt");
  assertPayload(row.payload);
  return {
    ...row,
    payloadJson: canonicalJson(row.payload),
    contentHash: semanticContentHash(row.entityKind, row.payload),
  };
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(payloadJson);
    if (!isRecord(payload)) {
      throw new BaseSnapshotCorruptRowError(
        "base_snapshot.payload must contain a JSON object",
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof BaseSnapshotCorruptRowError) throw error;
    throw new BaseSnapshotCorruptRowError(
      "base_snapshot.payload contains invalid JSON",
      { cause: error },
    );
  }
}

function parseBaseRow(value: unknown, expectedKind: EntityKind): BaseRow {
  if (
    !isRecord(value)
    || typeof value["project_id"] !== "string"
    || typeof value["project_version_id"] !== "string"
    || value["entity_kind"] !== expectedKind
    || typeof value["generation_id"] !== "string"
    || typeof value["entity_key"] !== "string"
    || (value["remote_id"] !== null && typeof value["remote_id"] !== "string")
    || typeof value["payload"] !== "string"
    || typeof value["content_hash"] !== "string"
    || typeof value["pulled_at"] !== "string"
  ) {
    throw new BaseSnapshotCorruptRowError(
      "base_snapshot row does not satisfy the frozen store contract",
    );
  }
  return {
    projectId: value["project_id"],
    projectVersionId: value["project_version_id"],
    entityKind: expectedKind,
    generationId: value["generation_id"],
    entityKey: value["entity_key"],
    remoteId: value["remote_id"],
    payload: parsePayload(value["payload"]),
    contentHash: value["content_hash"],
    pulledAt: value["pulled_at"],
  };
}

function parseSyncState(value: unknown): SyncState | null {
  if (value === undefined) return null;
  if (
    !isRecord(value)
    || (value["accepted_generation_id"] !== null
      && typeof value["accepted_generation_id"] !== "string")
    || (value["staging_generation_id"] !== null
      && typeof value["staging_generation_id"] !== "string")
    || typeof value["base_revision"] !== "number"
    || !Number.isInteger(value["base_revision"])
    || value["base_revision"] < 0
  ) {
    throw new BaseSnapshotCorruptRowError(
      "sync_state row does not satisfy the frozen store contract",
    );
  }
  return {
    acceptedGenerationId: value["accepted_generation_id"],
    stagingGenerationId: value["staging_generation_id"],
    baseRevision: value["base_revision"],
  };
}

function readSyncState(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  kind: EntityKind,
): SyncState | null {
  const row = db.prepare(
    `SELECT accepted_generation_id, staging_generation_id, base_revision
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
  ).get(projectId, projectVersionId, kind);
  return parseSyncState(row);
}

function assertAcceptedFence(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  kind: EntityKind,
  expected: { generationId: string; baseRevision: number },
): void {
  const state = readSyncState(db, projectId, projectVersionId, kind);
  if (
    state === null
    || state.acceptedGenerationId !== expected.generationId
    || state.baseRevision !== expected.baseRevision
  ) {
    throw new BaseSnapshotFenceError(
      `Accepted ${kind} base moved from generation ${expected.generationId} revision ${expected.baseRevision}`,
    );
  }
}

function incrementRevision(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  kind: EntityKind,
  expected: { generationId: string; baseRevision: number },
): number {
  const result = db.prepare(
    `UPDATE sync_state
        SET base_revision = base_revision + 1
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
        AND accepted_generation_id = ? AND base_revision = ?`,
  ).run(
    projectId,
    projectVersionId,
    kind,
    expected.generationId,
    expected.baseRevision,
  );
  if (result.changes !== 1) {
    throw new BaseSnapshotFenceError(
      `Accepted ${kind} base changed while advancing revision ${expected.baseRevision}`,
    );
  }
  return expected.baseRevision + 1;
}

export class BaseSnapshotStore {
  constructor(private readonly db: Database.Database) {}

  getAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    key: string,
  ): BaseRow | null {
    const row = this.db.prepare(
      `SELECT b.project_id, b.project_version_id, b.entity_kind,
              b.generation_id, b.entity_key, b.remote_id, b.payload,
              b.content_hash, b.pulled_at
         FROM base_snapshot b
         JOIN sync_state s
           ON s.project_id = b.project_id
          AND s.project_version_id = b.project_version_id
          AND s.entity_kind = b.entity_kind
          AND s.accepted_generation_id = b.generation_id
        WHERE b.project_id = ? AND b.project_version_id = ?
          AND b.entity_kind = ? AND b.entity_key = ?`,
    ).get(projectId, projectVersionId, kind, key);
    return row === undefined ? null : parseBaseRow(row, kind);
  }

  listAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
  ): BaseRow[] {
    return this.db.prepare(
      `SELECT b.project_id, b.project_version_id, b.entity_kind,
              b.generation_id, b.entity_key, b.remote_id, b.payload,
              b.content_hash, b.pulled_at
         FROM base_snapshot b
         JOIN sync_state s
           ON s.project_id = b.project_id
          AND s.project_version_id = b.project_version_id
          AND s.entity_kind = b.entity_kind
          AND s.accepted_generation_id = b.generation_id
        WHERE b.project_id = ? AND b.project_version_id = ?
          AND b.entity_kind = ?
        ORDER BY b.entity_key`,
    ).all(projectId, projectVersionId, kind).map((row) => parseBaseRow(row, kind));
  }

  putStagingPage(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    generationId: string,
    rows: BaseRow[],
  ): void {
    assertNonEmpty(projectId, "projectId");
    assertNonEmpty(projectVersionId, "projectVersionId");
    assertNonEmpty(generationId, "generationId");
    const preparedRows = rows.map((row) => {
      if (
        row.projectId !== projectId
        || row.projectVersionId !== projectVersionId
        || row.entityKind !== kind
        || row.generationId !== generationId
      ) {
        throw new BaseSnapshotInputError(
          "Every staging row must match the page project, version, kind, and generation",
        );
      }
      return prepareRow(row);
    });

    this.db.transaction(() => {
      const state = readSyncState(this.db, projectId, projectVersionId, kind);
      const generation = this.db.prepare(
        `SELECT status FROM pull_generation
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
      ).get(projectId, projectVersionId, generationId);
      if (
        state === null
        || state.stagingGenerationId !== generationId
        || state.acceptedGenerationId === generationId
        || !isRecord(generation)
        || generation["status"] !== "staging"
      ) {
        throw new BaseSnapshotFenceError(
          `Generation ${generationId} is not the active staging generation for ${kind}`,
        );
      }

      const insertBase = this.db.prepare(
        `INSERT INTO base_snapshot
           (project_id, project_version_id, entity_kind, generation_id,
            entity_key, remote_id, payload, content_hash, pulled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertId = this.db.prepare(
        `INSERT INTO id_map
           (project_id, project_version_id, entity_kind, generation_id,
            entity_key, remote_id, pulled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of preparedRows) {
        insertBase.run(
          row.projectId,
          row.projectVersionId,
          row.entityKind,
          row.generationId,
          row.entityKey,
          row.remoteId,
          row.payloadJson,
          row.contentHash,
          row.pulledAt,
        );
        if (row.remoteId !== null) {
          insertId.run(
            row.projectId,
            row.projectVersionId,
            row.entityKind,
            row.generationId,
            row.entityKey,
            row.remoteId,
            row.pulledAt,
          );
        }
      }
    })();
  }

  advanceAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    key: string,
    expected: {
      generationId: string;
      baseRevision: number;
      contentHash: string | null;
    },
    next: {
      payload: Record<string, unknown>;
      remoteId: string | null;
      pulledAt: string;
    },
  ): number {
    assertNonEmpty(key, "key");
    assertRemoteId(next.remoteId, "next.remoteId");
    assertNonEmpty(next.pulledAt, "next.pulledAt");
    const prepared = prepareRow({
      projectId,
      projectVersionId,
      entityKind: kind,
      generationId: expected.generationId,
      entityKey: key,
      remoteId: next.remoteId,
      payload: next.payload,
      contentHash: "",
      pulledAt: next.pulledAt,
    });

    return this.db.transaction(() => {
      assertAcceptedFence(this.db, projectId, projectVersionId, kind, expected);
      const current = this.db.prepare(
        `SELECT content_hash FROM base_snapshot
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND generation_id = ? AND entity_key = ?`,
      ).get(projectId, projectVersionId, kind, expected.generationId, key);
      const currentHash = current === undefined
        ? null
        : isRecord(current) && typeof current["content_hash"] === "string"
          ? current["content_hash"]
          : undefined;
      if (currentHash === undefined) {
        throw new BaseSnapshotCorruptRowError(
          "base_snapshot content hash does not satisfy the frozen store contract",
        );
      }
      if (currentHash !== expected.contentHash) {
        throw new BaseSnapshotFenceError(
          `Accepted ${kind}/${key} content changed from the expected hash`,
        );
      }

      if (currentHash === null) {
        this.db.prepare(
          `INSERT INTO base_snapshot
             (project_id, project_version_id, entity_kind, generation_id,
              entity_key, remote_id, payload, content_hash, pulled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          projectId,
          projectVersionId,
          kind,
          expected.generationId,
          key,
          next.remoteId,
          prepared.payloadJson,
          prepared.contentHash,
          next.pulledAt,
        );
      } else {
        const result = this.db.prepare(
          `UPDATE base_snapshot
              SET remote_id = ?, payload = ?, content_hash = ?, pulled_at = ?
            WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
              AND generation_id = ? AND entity_key = ?`,
        ).run(
          next.remoteId,
          prepared.payloadJson,
          prepared.contentHash,
          next.pulledAt,
          projectId,
          projectVersionId,
          kind,
          expected.generationId,
          key,
        );
        if (result.changes !== 1) {
          throw new BaseSnapshotFenceError(`Accepted ${kind}/${key} disappeared while advancing`);
        }
      }

      if (next.remoteId === null) {
        this.db.prepare(
          `DELETE FROM id_map
            WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
              AND generation_id = ? AND entity_key = ?`,
        ).run(projectId, projectVersionId, kind, expected.generationId, key);
      } else {
        this.db.prepare(
          `INSERT INTO id_map
             (project_id, project_version_id, entity_kind, generation_id,
              entity_key, remote_id, pulled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (project_id, project_version_id, entity_kind, generation_id, entity_key)
           DO UPDATE SET remote_id = excluded.remote_id, pulled_at = excluded.pulled_at`,
        ).run(
          projectId,
          projectVersionId,
          kind,
          expected.generationId,
          key,
          next.remoteId,
          next.pulledAt,
        );
      }
      return incrementRevision(this.db, projectId, projectVersionId, kind, expected);
    })();
  }

  deleteAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    key: string,
    expected: {
      generationId: string;
      baseRevision: number;
      contentHash: string;
    },
  ): number {
    return this.db.transaction(() => {
      assertAcceptedFence(this.db, projectId, projectVersionId, kind, expected);
      const result = this.db.prepare(
        `DELETE FROM base_snapshot
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND generation_id = ? AND entity_key = ? AND content_hash = ?`,
      ).run(
        projectId,
        projectVersionId,
        kind,
        expected.generationId,
        key,
        expected.contentHash,
      );
      if (result.changes !== 1) {
        throw new BaseSnapshotFenceError(
          `Accepted ${kind}/${key} is absent or has a different content hash`,
        );
      }
      this.db.prepare(
        `DELETE FROM id_map
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND generation_id = ? AND entity_key = ?`,
      ).run(projectId, projectVersionId, kind, expected.generationId, key);
      return incrementRevision(this.db, projectId, projectVersionId, kind, expected);
    })();
  }
}
