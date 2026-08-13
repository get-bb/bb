import type Database from "better-sqlite3";
import type { EntityKind } from "../../../lib/sync/registry.js";
import { RemoteError } from "../../../lib/remote/types.js";
import type { Plan } from "../../sync/plan/index.js";
import type { EntityPusher, PushContext, PushReport } from "../../sync/push/types.js";
import { beginHeadOnlyGroup, commitHeadOnlyGroup, type HeadOnlyGroupToken, type TaraFence } from "./checkpoint.js";

export function withProductSecurityHeadFence(db: Database.Database, pusher: EntityPusher): EntityPusher {
  return {
    ...pusher,
    maxConcurrency: 1,
    async beginGroup(items, ctx) { return beginHeadOnlyGroup(db, pusher.kind, items, ctx); },
    async commitGroup(items, ctx, token) {
      commitHeadOnlyGroup(db, pusher.kind, items, ctx, token as HeadOnlyGroupToken);
    },
  };
}

export interface ProductSecurityPushContext extends PushContext {
  currentFence(kind: EntityKind): TaraFence;
  execute(plan: Plan): Promise<PushReport>;
}

export async function pushProductSecurity(ctx: ProductSecurityPushContext, plan: Plan, fence: TaraFence): Promise<PushReport> {
  const kinds = [...new Set(plan.items.filter((item) => item.operation !== "noop").map((item) => item.kind))];
  for (const kind of kinds) {
    const current = ctx.currentFence(kind);
    if (current.headVersionId !== fence.headVersionId || (fence.workingContentHash !== undefined && current.workingContentHash !== fence.workingContentHash)) {
      throw new RemoteError("STALE_TARA_STATE: head-only fence mismatch before writes; pull and re-plan", {
        service: "assurance-studio",
        code: "AS_STALE_TARA_STATE",
        status: 409,
        retryable: false,
        retryAfterMs: null,
        details: { code: "stale_tara_state" },
      });
    }
  }
  return await ctx.execute(plan);
}

export type { TaraFence } from "./checkpoint.js";
