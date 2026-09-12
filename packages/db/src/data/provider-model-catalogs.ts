import { and, eq, lt, ne } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { providerModelCatalogs } from "../schema.js";

export type StoredProviderModelCatalog =
  typeof providerModelCatalogs.$inferSelect;

export type ProviderModelCatalogRowKey = Pick<
  StoredProviderModelCatalog,
  "hostId" | "providerId" | "scopeKey"
>;

export function getStoredProviderModelCatalog(
  db: DbConnection,
  key: ProviderModelCatalogRowKey,
): StoredProviderModelCatalog | null {
  return (
    db
      .select()
      .from(providerModelCatalogs)
      .where(
        and(
          eq(providerModelCatalogs.hostId, key.hostId),
          eq(providerModelCatalogs.providerId, key.providerId),
          eq(providerModelCatalogs.scopeKey, key.scopeKey),
        ),
      )
      .get() ?? null
  );
}

export function replaceStoredProviderModelCatalog(
  db: DbConnection,
  args: {
    row: StoredProviderModelCatalog;
    pruneWorkspaceRowsFetchedBefore: number | null;
  },
): void {
  const { row, pruneWorkspaceRowsFetchedBefore } = args;
  db.transaction((tx) => {
    tx.insert(providerModelCatalogs)
      .values(row)
      .onConflictDoUpdate({
        target: [
          providerModelCatalogs.hostId,
          providerModelCatalogs.providerId,
          providerModelCatalogs.scopeKey,
        ],
        set: {
          fingerprint: row.fingerprint,
          modelsJson: row.modelsJson,
          selectedOnlyModelsJson: row.selectedOnlyModelsJson,
          fetchedAt: row.fetchedAt,
        },
      })
      .run();
    if (pruneWorkspaceRowsFetchedBefore !== null) {
      tx.delete(providerModelCatalogs)
        .where(
          and(
            eq(providerModelCatalogs.hostId, row.hostId),
            eq(providerModelCatalogs.providerId, row.providerId),
            ne(providerModelCatalogs.scopeKey, ""),
            lt(
              providerModelCatalogs.fetchedAt,
              pruneWorkspaceRowsFetchedBefore,
            ),
          ),
        )
        .run();
    }
  });
}

export function deleteStoredProviderModelCatalogsForHost(
  db: DbConnection,
  hostId: string,
): void {
  db.delete(providerModelCatalogs)
    .where(eq(providerModelCatalogs.hostId, hostId))
    .run();
}
