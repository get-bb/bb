import type Database from "better-sqlite3";

import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { ENTITIES, type EntityKind } from "../../../lib/sync/registry.js";
import type { Plan, PlanItem, PlanOp } from "../plan/index.js";
import type { PushErrorDetail } from "./types.js";

export type PushLogStatus = "pending" | "applied" | "failed" | "skipped";

export interface StoredPushError extends PushErrorDetail {
  requiresPull: boolean;
}

export interface PushLogEntry {
  id: number;
  projectId: string;
  projectVersionId: string;
  runId: string;
  baseGenerationId: string;
  baseRevision: number;
  expectedBaseContentHash: string | null;
  kind: EntityKind;
  key: string;
  operation: Exclude<PlanOp, "orphan">;
  status: PushLogStatus;
  error: StoredPushError | null;
  createdAt: string;
  appliedAt: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isKind(value: unknown): value is EntityKind {
  return typeof value === "string" && Object.hasOwn(ENTITIES, value);
}

function isOperation(value: unknown): value is PushLogEntry["operation"] {
  return value === "create"
    || value === "update"
    || value === "delete"
    || value === "noop"
    || value === "conflict";
}

function isStatus(value: unknown): value is PushLogStatus {
  return value === "pending"
    || value === "applied"
    || value === "failed"
    || value === "skipped";
}

function parseStoredError(value: string | null): StoredPushError | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error: unknown) {
    throw new Error("push_log.error contains invalid JSON", { cause: error });
  }
  if (
    !isRecord(parsed)
    || typeof parsed["code"] !== "string"
    || parsed["code"].length === 0
    || typeof parsed["message"] !== "string"
    || parsed["message"].length > 500
    || typeof parsed["retryable"] !== "boolean"
    || typeof parsed["requiresPull"] !== "boolean"
  ) {
    throw new Error("push_log.error does not satisfy the push error contract");
  }
  return {
    code: parsed["code"],
    message: parsed["message"],
    retryable: parsed["retryable"],
    requiresPull: parsed["requiresPull"],
  };
}

function parseRow(value: unknown): PushLogEntry {
  if (
    !isRecord(value)
    || typeof value["id"] !== "number"
    || !Number.isSafeInteger(value["id"])
    || typeof value["project_id"] !== "string"
    || typeof value["project_version_id"] !== "string"
    || typeof value["run_id"] !== "string"
    || typeof value["base_generation_id"] !== "string"
    || typeof value["base_revision"] !== "number"
    || !Number.isSafeInteger(value["base_revision"])
    || value["base_revision"] < 0
    || (value["expected_base_content_hash"] !== null
      && typeof value["expected_base_content_hash"] !== "string")
    || !isKind(value["entity_kind"])
    || typeof value["entity_key"] !== "string"
    || !isOperation(value["op"])
    || !isStatus(value["status"])
    || (value["error"] !== null && typeof value["error"] !== "string")
    || typeof value["created_at"] !== "string"
    || (value["applied_at"] !== null && typeof value["applied_at"] !== "string")
  ) {
    throw new Error("push_log row does not satisfy the frozen store contract");
  }
  return {
    id: value["id"],
    projectId: value["project_id"],
    projectVersionId: value["project_version_id"],
    runId: value["run_id"],
    baseGenerationId: value["base_generation_id"],
    baseRevision: value["base_revision"],
    expectedBaseContentHash: value["expected_base_content_hash"],
    kind: value["entity_kind"],
    key: value["entity_key"],
    operation: value["op"],
    status: value["status"],
    error: parseStoredError(value["error"]),
    createdAt: value["created_at"],
    appliedAt: value["applied_at"],
  };
}

function serializedError(error: StoredPushError | null): string | null {
  if (error === null) return null;
  if (error.message.length > 500) throw new Error("push error message exceeds the frozen safe detail limit");
  return JSON.stringify(error);
}

function assertLoggable(item: PlanItem): asserts item is PlanItem & {
  operation: PushLogEntry["operation"];
} {
  if (item.operation === "orphan") {
    throw new Error(`Orphan ${item.kind}/${item.key} cannot enter a push journal`);
  }
}

function sameEntry(entry: PushLogEntry, item: PlanItem, plan: Plan): boolean {
  return entry.kind === item.kind
    && entry.key === item.key
    && entry.operation === item.operation
    && entry.baseGenerationId === plan.baseGenerationIds[item.kind]
    && entry.expectedBaseContentHash === item.expectedBaseContentHash;
}

const SELECT_COLUMNS = `id, project_id, project_version_id, run_id,
  base_generation_id, base_revision, expected_base_content_hash,
  entity_kind, entity_key, op, status, error, created_at, applied_at`;

export class PushLogStore {
  constructor(private readonly db: Database.Database) {}

  initialize(plan: Plan, runId: string, createdAt: string): PushLogEntry[] {
    const projectVersionId = toStorageProjectVersionId(plan.projectVersionId);
    return this.db.transaction(() => {
      const existing = this.list(plan.projectId, projectVersionId, runId);
      if (existing.length > 0) {
        if (
          existing.length !== plan.items.length
          || existing.some((entry, index) => {
            const item = plan.items[index];
            return item === undefined || !sameEntry(entry, item, plan);
          })
        ) {
          throw new Error("PUSH_RUN_ID_REUSED: run id belongs to a different plan journal");
        }
        return existing;
      }

      const maximum = this.db.prepare(
        `SELECT COALESCE(MAX(id), 0) AS maximum
           FROM push_log
          WHERE project_id = ? AND project_version_id = ?`,
      ).get(plan.projectId, projectVersionId);
      if (!isRecord(maximum) || typeof maximum["maximum"] !== "number") {
        throw new Error("push_log maximum id query returned an invalid row");
      }
      let nextId = maximum["maximum"] + 1;
      const insert = this.db.prepare(
        `INSERT INTO push_log
           (project_id, project_version_id, id, run_id, base_generation_id,
            base_revision, expected_base_content_hash, entity_kind, entity_key,
            op, status, error, created_at, applied_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
      );
      for (const item of plan.items) {
        assertLoggable(item);
        const generationId = plan.baseGenerationIds[item.kind];
        const baseRevision = plan.baseRevisions[item.kind];
        if (generationId === undefined || baseRevision === undefined) {
          throw new Error(`PLAN_STALE: ${item.kind} has no accepted generation/revision fence`);
        }
        insert.run(
          plan.projectId,
          projectVersionId,
          nextId,
          runId,
          generationId,
          baseRevision,
          item.expectedBaseContentHash,
          item.kind,
          item.key,
          item.operation,
          item.operation === "noop" ? "skipped" : "pending",
          createdAt,
        );
        nextId += 1;
      }
      return this.list(plan.projectId, projectVersionId, runId);
    })();
  }

  list(projectId: string, projectVersionId: string, runId: string): PushLogEntry[] {
    return this.db.prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM push_log
        WHERE project_id = ? AND project_version_id = ? AND run_id = ?
        ORDER BY id`,
    ).all(projectId, projectVersionId, runId).map(parseRow);
  }

  get(
    projectId: string,
    projectVersionId: string,
    runId: string,
    kind: EntityKind,
    key: string,
  ): PushLogEntry | null {
    const row = this.db.prepare(
      `SELECT ${SELECT_COLUMNS}
         FROM push_log
        WHERE project_id = ? AND project_version_id = ? AND run_id = ?
          AND entity_kind = ? AND entity_key = ?`,
    ).get(projectId, projectVersionId, runId, kind, key);
    return row === undefined ? null : parseRow(row);
  }

  markPendingError(entry: PushLogEntry, error: StoredPushError): void {
    const updated = this.db.prepare(
      `UPDATE push_log SET error = ?
        WHERE project_id = ? AND project_version_id = ? AND id = ?
          AND run_id = ? AND status = 'pending'`,
    ).run(
      serializedError(error),
      entry.projectId,
      entry.projectVersionId,
      entry.id,
      entry.runId,
    );
    if (updated.changes !== 1) throw new Error(`Push log ${entry.id} is no longer pending`);
  }

  markFailed(entry: PushLogEntry, error: StoredPushError): void {
    const updated = this.db.prepare(
      `UPDATE push_log SET status = 'failed', error = ?, applied_at = NULL
        WHERE project_id = ? AND project_version_id = ? AND id = ?
          AND run_id = ? AND status IN ('pending', 'failed')`,
    ).run(
      serializedError(error),
      entry.projectId,
      entry.projectVersionId,
      entry.id,
      entry.runId,
    );
    if (updated.changes !== 1) throw new Error(`Push log ${entry.id} cannot be marked failed`);
  }

  resetRetryable(entry: PushLogEntry): void {
    if (entry.status !== "failed" || entry.error?.retryable !== true) {
      throw new Error(`Push log ${entry.id} is not retryable`);
    }
    const updated = this.db.prepare(
      `UPDATE push_log SET status = 'pending', error = NULL, applied_at = NULL
        WHERE project_id = ? AND project_version_id = ? AND id = ?
          AND run_id = ? AND status = 'failed'`,
    ).run(entry.projectId, entry.projectVersionId, entry.id, entry.runId);
    if (updated.changes !== 1) throw new Error(`Push log ${entry.id} cannot be retried`);
  }

  markAppliedAtomically(
    entry: PushLogEntry,
    baseRevision: number,
    appliedAt: string,
    advanceBase: () => void,
  ): void {
    this.db.transaction(() => {
      advanceBase();
      const updated = this.db.prepare(
        `UPDATE push_log
            SET status = 'applied', error = NULL, applied_at = ?, base_revision = ?
          WHERE project_id = ? AND project_version_id = ? AND id = ?
            AND run_id = ? AND status IN ('pending', 'failed')`,
      ).run(
        appliedAt,
        baseRevision,
        entry.projectId,
        entry.projectVersionId,
        entry.id,
        entry.runId,
      );
      if (updated.changes !== 1) throw new Error(`Push log ${entry.id} cannot be marked applied`);
    })();
  }
}
