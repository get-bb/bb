import { asc, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { marketplaces } from "../schema.js";
import type { PluginUpdatePolicy } from "./plugins.js";

export interface MarketplaceRow {
  id: string;
  displayName: string;
  sourceKind: "builtin" | "path" | "git";
  location: string;
  requestedGitRef: string | null;
  resolvedGitCommit: string | null;
  cachePath: string | null;
  contentHash: string | null;
  catalogJson: string | null;
  enabled: boolean;
  trusted: boolean;
  updatePolicy: PluginUpdatePolicy;
  autoCheck: boolean;
  autoApply: boolean;
  lastSuccessfulRefreshAt: number | null;
  lastAttemptedRefreshAt: number | null;
  lastError: string | null;
  scope: "builtin" | "user" | "project" | "managed";
  createdAt: number;
  updatedAt: number;
}

export type UpsertMarketplaceInput = Omit<
  MarketplaceRow,
  "createdAt" | "updatedAt"
>;

export function listMarketplaces(db: DbConnection): MarketplaceRow[] {
  return db.select().from(marketplaces).orderBy(asc(marketplaces.id)).all();
}

export function getMarketplace(
  db: DbConnection,
  id: string,
): MarketplaceRow | undefined {
  return db.select().from(marketplaces).where(eq(marketplaces.id, id)).get();
}

export function upsertMarketplace(
  db: DbConnection,
  marketplace: UpsertMarketplaceInput,
): MarketplaceRow {
  if (
    marketplace.sourceKind !== "git" &&
    (marketplace.requestedGitRef !== null ||
      marketplace.resolvedGitCommit !== null)
  ) {
    throw new Error("only git marketplaces may carry git resolution fields");
  }
  const now = Date.now();
  db.insert(marketplaces)
    .values({ ...marketplace, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: marketplaces.id,
      set: { ...marketplace, updatedAt: now },
    })
    .run();
  const row = getMarketplace(db, marketplace.id);
  if (!row) throw new Error(`marketplace missing after upsert: ${marketplace.id}`);
  return row;
}

export function deleteMarketplace(db: DbConnection, id: string): boolean {
  return db.delete(marketplaces).where(eq(marketplaces.id, id)).run().changes > 0;
}

export function updateMarketplaceRefreshFailure(
  db: DbConnection,
  id: string,
  attemptedAt: number,
  error: string,
): MarketplaceRow | undefined {
  db.update(marketplaces)
    .set({
      lastAttemptedRefreshAt: attemptedAt,
      lastError: error,
      updatedAt: attemptedAt,
    })
    .where(eq(marketplaces.id, id))
    .run();
  return getMarketplace(db, id);
}

export function setMarketplaceAutoPolicy(
  db: DbConnection,
  id: string,
  policy: { autoCheck: boolean; autoApply: boolean },
): MarketplaceRow | undefined {
  db.update(marketplaces)
    .set({ ...policy, updatedAt: Date.now() })
    .where(eq(marketplaces.id, id))
    .run();
  return getMarketplace(db, id);
}
