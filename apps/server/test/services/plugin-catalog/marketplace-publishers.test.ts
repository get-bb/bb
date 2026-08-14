import { createConnection, migrate, upsertPluginMarketplace } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  marketplacePublisherLabels,
  pluginPublisherLabel,
} from "../../../src/services/plugin-catalog/marketplace-publishers.js";
import { BUNDLED_OFFICIAL_MARKETPLACE } from "../../../src/services/plugin-catalog/official-marketplace.js";

function connect() {
  const db = createConnection(":memory:");
  migrate(db);
  return db;
}

function register(
  db: ReturnType<typeof connect>,
  name: string,
  manifestJson: string,
) {
  upsertPluginMarketplace(db, {
    name,
    sourceKind: "https",
    manifestUrl: `https://${name}.test/marketplace.json`,
    sourceGitRef: null,
    sourceGitCommit: null,
    manifestJson,
    etag: null,
    lastModified: null,
    lastSuccessfulRefreshAt: null,
    lastAttemptedRefreshAt: null,
    lastError: null,
  });
}

describe("marketplace publisher labels", () => {
  it("names each marketplace by its own display name", () => {
    const db = connect();
    register(
      db,
      "bb-official",
      JSON.stringify({
        schemaVersion: 1,
        name: "bb-official",
        displayName: "BB Community",
        plugins: [],
      }),
    );
    register(
      db,
      "acme",
      JSON.stringify({
        schemaVersion: 1,
        name: "acme",
        displayName: "Acme Plugins",
        plugins: [],
      }),
    );
    const labels = marketplacePublisherLabels(db);

    expect(
      pluginPublisherLabel({
        provenance: "catalog",
        catalogMarketplaceName: "bb-official",
        labels,
      }),
    ).toBe("BB Community");
    expect(
      pluginPublisherLabel({
        provenance: "catalog",
        catalogMarketplaceName: "acme",
        labels,
      }),
    ).toBe("Acme Plugins");
  });

  it("keeps a badge when the stored manifest no longer parses", () => {
    const db = connect();
    register(db, "acme", "{ not json");
    const labels = marketplacePublisherLabels(db);

    // The row is still a real marketplace, so the plugin keeps a publisher —
    // it just falls back to the name bb keys the marketplace on.
    expect(
      pluginPublisherLabel({
        provenance: "catalog",
        catalogMarketplaceName: "acme",
        labels,
      }),
    ).toBe("acme");
  });

  it("badges bundled plugins BB Official and user installs not at all", () => {
    const labels = marketplacePublisherLabels(connect());

    expect(
      pluginPublisherLabel({
        provenance: "builtin",
        catalogMarketplaceName: null,
        labels,
      }),
    ).toBe("BB Official");
    expect(
      pluginPublisherLabel({
        provenance: "direct",
        catalogMarketplaceName: null,
        labels,
      }),
    ).toBeNull();
  });

  it("does not reuse BB Official for the marketplace bb curates", () => {
    // The two labels are the whole point of the split: a bundled plugin and a
    // registry listing must not badge the same.
    expect(BUNDLED_OFFICIAL_MARKETPLACE.displayName).toBe("BB Community");
  });
});
