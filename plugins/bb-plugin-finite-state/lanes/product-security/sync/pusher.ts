import type Database from "better-sqlite3";
import type { EntityPusher } from "../../sync/push/types.js";
import { beginHeadOnlyGroup, commitHeadOnlyGroup, isHeadOnlyGroupToken } from "./checkpoint.js";

export function withProductSecurityHeadFence(db: Database.Database, pusher: EntityPusher): EntityPusher {
  return {
    ...pusher,
    maxConcurrency: 1,
    async beginGroup(items, ctx) { return beginHeadOnlyGroup(db, pusher.kind, items, ctx); },
    async commitGroup(items, ctx, token) {
      if (!isHeadOnlyGroupToken(token)) throw new Error("PRODUCT_SECURITY_GROUP_TOKEN_INVALID");
      commitHeadOnlyGroup(db, pusher.kind, items, ctx, token);
    },
  };
}
