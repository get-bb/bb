import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  deleteStoredProviderModelCatalogsForHost,
  getStoredProviderModelCatalog,
  hosts,
  migrate,
  noopNotifier,
  providerModelCatalogs,
  replaceStoredProviderModelCatalog,
  upsertHost,
  type DbConnection,
  type StoredProviderModelCatalog,
} from "../../src/index.js";

function catalogRow(
  hostId: string,
  providerId: string,
  scopeKey: string,
  fetchedAt = 1_000,
): StoredProviderModelCatalog {
  return {
    hostId,
    providerId,
    scopeKey,
    fingerprint: `${hostId}-${providerId}-${scopeKey}`,
    modelsJson: JSON.stringify([{ id: "gpt-5", model: "gpt-5" }]),
    selectedOnlyModelsJson: "[]",
    fetchedAt,
  };
}

function writeRows(db: DbConnection, rows: StoredProviderModelCatalog[]) {
  for (const row of rows) {
    replaceStoredProviderModelCatalog(db, {
      row,
      pruneWorkspaceRowsFetchedBefore: null,
    });
  }
}

function listRowKeys(db: DbConnection): string[] {
  return db
    .select()
    .from(providerModelCatalogs)
    .all()
    .map((row) => `${row.hostId}|${row.providerId}|${row.scopeKey}`)
    .sort();
}

describe("provider model catalogs data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    upsertHost(db, noopNotifier, { id: "h1", name: "Host 1" });
    upsertHost(db, noopNotifier, { id: "h2", name: "Host 2" });
  });

  afterEach(() => {
    db.$client.close();
  });

  it("replaces the row for the same key and reads only the exact host, provider and scope", () => {
    writeRows(db, [
      catalogRow("h1", "codex", ""),
      catalogRow("h1", "codex", "/w/a"),
      catalogRow("h1", "claude-code", ""),
      catalogRow("h2", "codex", ""),
    ]);
    const replacement: StoredProviderModelCatalog = {
      ...catalogRow("h1", "codex", "", 2_000),
      fingerprint: "fp-2",
      selectedOnlyModelsJson: JSON.stringify([
        { id: "legacy", model: "legacy" },
      ]),
    };
    writeRows(db, [replacement]);

    const key = { hostId: "h1", providerId: "codex", scopeKey: "" };
    expect(getStoredProviderModelCatalog(db, key)).toEqual(replacement);
    expect(
      getStoredProviderModelCatalog(db, { ...key, scopeKey: "/w/a" }),
    ).toEqual(catalogRow("h1", "codex", "/w/a"));
    expect(getStoredProviderModelCatalog(db, { ...key, hostId: "h2" })).toEqual(
      catalogRow("h2", "codex", ""),
    );
    expect(
      getStoredProviderModelCatalog(db, { ...key, scopeKey: "/w/b" }),
    ).toBeNull();
    expect(listRowKeys(db)).toEqual([
      "h1|claude-code|",
      "h1|codex|",
      "h1|codex|/w/a",
      "h2|codex|",
    ]);
  });

  it("deletes every row of one host and cascades a deleted host row, keeping other hosts", () => {
    writeRows(db, [
      catalogRow("h1", "codex", ""),
      catalogRow("h1", "pi", "/w/a"),
      catalogRow("h2", "codex", ""),
      catalogRow("h2", "pi", "/w/b"),
    ]);

    deleteStoredProviderModelCatalogsForHost(db, "h1");
    expect(listRowKeys(db)).toEqual(["h2|codex|", "h2|pi|/w/b"]);

    db.delete(hosts).where(eq(hosts.id, "h2")).run();
    expect(listRowKeys(db)).toEqual([]);
  });

  it("prunes only that host and provider's workspace rows older than the cutoff", () => {
    const cutoff = 10_000;
    writeRows(db, [
      catalogRow("h1", "pi", "", 1),
      catalogRow("h1", "pi", "/w/old", cutoff - 1),
      catalogRow("h1", "pi", "/w/at-cutoff", cutoff),
      catalogRow("h1", "opencode", "/w/old", 1),
      catalogRow("h2", "pi", "/w/old", 1),
    ]);

    replaceStoredProviderModelCatalog(db, {
      row: catalogRow("h1", "pi", "/w/current", cutoff + 5_000),
      pruneWorkspaceRowsFetchedBefore: cutoff,
    });

    expect(listRowKeys(db)).toEqual([
      "h1|opencode|/w/old",
      "h1|pi|",
      "h1|pi|/w/at-cutoff",
      "h1|pi|/w/current",
      "h2|pi|/w/old",
    ]);
  });
});
