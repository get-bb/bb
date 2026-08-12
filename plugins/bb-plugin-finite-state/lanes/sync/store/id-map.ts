import type Database from "better-sqlite3";

import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";

export interface IdMapEntry {
  projectId: string;
  projectVersionId: string;
  entityKind: EntityKind;
  generationId: string;
  entityKey: string;
  remoteId: string;
}

export class IdMapInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdMapInputError";
  }
}

export class IdMapFenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdMapFenceError";
  }
}

export class IdMapCorruptRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdMapCorruptRowError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && Object.hasOwn(ENTITIES, value);
}

function assertEntry(entry: IdMapEntry): void {
  for (const [label, value] of [
    ["projectId", entry.projectId],
    ["projectVersionId", entry.projectVersionId],
    ["generationId", entry.generationId],
    ["entityKey", entry.entityKey],
    ["remoteId", entry.remoteId],
  ] as const) {
    if (value.length === 0) throw new IdMapInputError(`${label} must not be empty`);
  }
}

function parseEntry(value: unknown): IdMapEntry {
  if (
    !isRecord(value)
    || typeof value["project_id"] !== "string"
    || typeof value["project_version_id"] !== "string"
    || !isEntityKind(value["entity_kind"])
    || typeof value["generation_id"] !== "string"
    || typeof value["entity_key"] !== "string"
    || typeof value["remote_id"] !== "string"
  ) {
    throw new IdMapCorruptRowError(
      "id_map row does not satisfy the frozen store contract",
    );
  }
  return {
    projectId: value["project_id"],
    projectVersionId: value["project_version_id"],
    entityKind: value["entity_kind"],
    generationId: value["generation_id"],
    entityKey: value["entity_key"],
    remoteId: value["remote_id"],
  };
}

function scalarString(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new IdMapCorruptRowError(`${label} must be a string`);
  }
  return value;
}

export class IdMapStore {
  constructor(private readonly db: Database.Database) {}

  resolveAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    key: string,
  ): string | null {
    const row = this.db.prepare(
      `SELECT m.remote_id
         FROM id_map m
         JOIN sync_state s
           ON s.project_id = m.project_id
          AND s.project_version_id = m.project_version_id
          AND s.entity_kind = m.entity_kind
          AND s.accepted_generation_id = m.generation_id
        WHERE m.project_id = ? AND m.project_version_id = ?
          AND m.entity_kind = ? AND m.entity_key = ?`,
    ).get(projectId, projectVersionId, kind, key);
    return scalarString(
      isRecord(row) ? row["remote_id"] : row,
      "id_map.remote_id",
    );
  }

  reverseAccepted(
    projectId: string,
    projectVersionId: string,
    kind: EntityKind,
    remoteId: string,
  ): string | null {
    const row = this.db.prepare(
      `SELECT m.entity_key
         FROM id_map m
         JOIN sync_state s
           ON s.project_id = m.project_id
          AND s.project_version_id = m.project_version_id
          AND s.entity_kind = m.entity_kind
          AND s.accepted_generation_id = m.generation_id
        WHERE m.project_id = ? AND m.project_version_id = ?
          AND m.entity_kind = ? AND m.remote_id = ?`,
    ).get(projectId, projectVersionId, kind, remoteId);
    return scalarString(
      isRecord(row) ? row["entity_key"] : row,
      "id_map.entity_key",
    );
  }

  learnAccepted(
    entry: IdMapEntry,
    expected: { generationId: string; baseRevision: number },
  ): number {
    assertEntry(entry);
    if (entry.generationId !== expected.generationId) {
      throw new IdMapInputError(
        "entry.generationId must match expected.generationId",
      );
    }

    return this.db.transaction(() => {
      const state = this.db.prepare(
        `SELECT accepted_generation_id, base_revision
           FROM sync_state
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
      ).get(entry.projectId, entry.projectVersionId, entry.entityKind);
      if (
        !isRecord(state)
        || state["accepted_generation_id"] !== expected.generationId
        || state["base_revision"] !== expected.baseRevision
      ) {
        throw new IdMapFenceError(
          `Accepted ${entry.entityKind} mapping moved from generation ${expected.generationId} revision ${expected.baseRevision}`,
        );
      }

      this.db.prepare(
        `INSERT INTO id_map
           (project_id, project_version_id, entity_kind, generation_id,
            entity_key, remote_id, pulled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, project_version_id, entity_kind, generation_id, entity_key)
         DO UPDATE SET remote_id = excluded.remote_id, pulled_at = excluded.pulled_at`,
      ).run(
        entry.projectId,
        entry.projectVersionId,
        entry.entityKind,
        entry.generationId,
        entry.entityKey,
        entry.remoteId,
        new Date().toISOString(),
      );

      const revision = this.db.prepare(
        `UPDATE sync_state
            SET base_revision = base_revision + 1
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?
            AND accepted_generation_id = ? AND base_revision = ?`,
      ).run(
        entry.projectId,
        entry.projectVersionId,
        entry.entityKind,
        expected.generationId,
        expected.baseRevision,
      );
      if (revision.changes !== 1) {
        throw new IdMapFenceError(
          `Accepted ${entry.entityKind} mapping changed while learning ${entry.entityKey}`,
        );
      }
      return expected.baseRevision + 1;
    })();
  }

  dumpAccepted(projectId: string, projectVersionId: string): IdMapEntry[] {
    return this.db.prepare(
      `SELECT m.project_id, m.project_version_id, m.entity_kind,
              m.generation_id, m.entity_key, m.remote_id
         FROM id_map m
         JOIN sync_state s
           ON s.project_id = m.project_id
          AND s.project_version_id = m.project_version_id
          AND s.entity_kind = m.entity_kind
          AND s.accepted_generation_id = m.generation_id
        WHERE m.project_id = ? AND m.project_version_id = ?
        ORDER BY m.entity_kind, m.entity_key`,
    ).all(projectId, projectVersionId).map(parseEntry);
  }
}
