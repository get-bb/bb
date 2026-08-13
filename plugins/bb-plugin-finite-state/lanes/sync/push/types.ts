import type Database from "better-sqlite3";

import type { EntityKind } from "../../../lib/sync/registry.js";
import type { PlanItem } from "../plan/index.js";
import type { SyncScope } from "../engine/adapter.js";

export type PushVerification = "required" | "response-is-authoritative";

export interface PushContext {
  runId: string;
  scope: SyncScope;
  signal?: AbortSignal;
}

export interface ApplyResult {
  remoteId: string | null;
  serverPayload: Record<string, unknown> | null;
  verification: PushVerification;
}

export interface ReadBackResult {
  exists: boolean;
  remoteId: string | null;
  payload: Record<string, unknown> | null;
}

export interface EntityPusher {
  readonly kind: EntityKind;
  readonly maxConcurrency: number;
  beginGroup?(items: readonly PlanItem[], ctx: PushContext): Promise<unknown>;
  apply(item: PlanItem, ctx: PushContext, groupToken?: unknown): Promise<ApplyResult>;
  readBack(item: PlanItem, ctx: PushContext): Promise<ReadBackResult>;
  commitGroup?(
    items: readonly PlanItem[],
    ctx: PushContext,
    groupToken: unknown,
  ): Promise<void>;
}

export interface PushOptions {
  scope: SyncScope;
  planId: string;
  expectedPlanSha256: string;
  expectedBaseStateSha256: string;
  confirmed: boolean;
  runId?: string;
  signal?: AbortSignal;
  pageSize?: number;
  continuation?: string | null;
}

export interface PushErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PushItemResult {
  projectId: string;
  projectVersionId: string | null;
  kind: EntityKind;
  key: string;
  expectedBaseContentHash: string | null;
  status: "applied" | "failed" | "skipped";
  newBaseContentHash: string | null;
  error: PushErrorDetail | null;
}

export interface PushCacheState {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
  acceptedGenerationId: string | null;
  baseRevision: number;
}

export interface PushReport {
  projectId: string;
  projectVersionId: string | null;
  runId: string;
  planId: string;
  planSha256: string;
  baseGenerationIds: Record<string, string>;
  baseRevisions: Record<string, number>;
  baseStateSha256: string;
  status: "completed" | "partial" | "failed";
  summary: { total: number; applied: number; failed: number; skipped: number };
  items: PushItemResult[];
  total: number | null;
  next: string | null;
  requiresPull: boolean;
  cache: PushCacheState;
}

export interface PushProgress {
  runId: string;
  phase: "prepare" | "reconcile" | "apply" | "verify" | "completed" | "failed";
  completed: number;
  total: number;
  applied?: number;
  failed?: number;
  skipped?: number;
}

export interface PushDeps {
  db: Database.Database;
  worktreeRoot?: string | null;
  now?(): Date;
  createRunId?(): string;
  pushers?: readonly EntityPusher[];
  publishPush?(progress: PushProgress): void;
}

export class PushExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly requiresPull = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PushExecutionError";
  }
}
