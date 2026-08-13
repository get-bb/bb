import type Database from "better-sqlite3";
import type { EntityKind } from "../../../lib/sync/registry.js";
import { RemoteError } from "../../../lib/remote/types.js";
import type { PlanItem } from "../../sync/plan/index.js";
import type { PushContext } from "../../sync/push/types.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";

export interface TaraFence { headVersionId: string; workingContentHash?: string }
export interface HeadOnlyGroupToken { generationId: string; baseRevision: number; itemCount: number }
interface StateRow { accepted_generation_id: string | null; base_revision: number }

function staleTaraState(message: string): RemoteError {
  return new RemoteError(message, {
    service: "assurance-studio",
    code: "AS_STALE_TARA_STATE",
    status: 409,
    retryable: false,
    retryAfterMs: null,
    details: { code: "stale_tara_state" },
  });
}

function state(db: Database.Database, ctx: PushContext, kind: EntityKind): StateRow | null {
  return db.prepare<[string, string, string], StateRow>(`SELECT accepted_generation_id, base_revision FROM sync_state WHERE project_id=? AND project_version_id=? AND entity_kind=?`).get(ctx.scope.projectId, toStorageProjectVersionId(ctx.scope.projectVersionId), kind) ?? null;
}

export function beginHeadOnlyGroup(db: Database.Database, kind: EntityKind, items: readonly PlanItem[], ctx: PushContext): HeadOnlyGroupToken {
  const current = state(db, ctx, kind);
  if (!current?.accepted_generation_id) throw staleTaraState("STALE_TARA_STATE: accepted TARA head is unavailable; pull and re-plan");
  return { generationId: current.accepted_generation_id, baseRevision: current.base_revision, itemCount: items.length };
}

export function commitHeadOnlyGroup(db: Database.Database, kind: EntityKind, _items: readonly PlanItem[], ctx: PushContext, token: HeadOnlyGroupToken): void {
  const current = state(db, ctx, kind);
  if (!current || current.accepted_generation_id !== token.generationId || current.base_revision !== token.baseRevision + token.itemCount) {
    throw staleTaraState("STALE_TARA_STATE: accepted TARA head moved during ordered row writes; pull and re-plan");
  }
  // No public Assurance Studio checkpoint route exists. This verifies the
  // local accepted head bracket only; concurrent remote row writes remain an
  // honest residual race and are detected only when a row route returns 409.
  // The true fenced three-way trial operation remains agents-API-only.
}
