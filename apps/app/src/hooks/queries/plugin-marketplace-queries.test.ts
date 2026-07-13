import { describe, expect, it } from "vitest";
import {
  applyPluginUpdate,
  checkPluginUpdates,
  fetchMarketplaces,
  installPlugin,
  removeMarketplace,
  searchMarketplaces,
} from "./plugin-marketplace-queries";

function fetchReturning(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

/** fetchReturning plus a record of every (url, init) it was called with. */
function recordingFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = fetchReturning(body, status);
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return impl();
  };
  return { fetchImpl, calls };
}

// Server-shaped PluginUpdateCheckEntry fixtures — one per outcome kind.
const UPDATES_RESULTS = [
  {
    id: "current-plugin",
    outcome: "current",
    installed: { version: "1.0.0", display: "1.0.0" },
  },
  {
    id: "updatable-plugin",
    outcome: "update-available",
    installed: { version: "1.6.2", display: "1.6.2" },
    candidate: { version: "1.7.0", display: "1.7.0" },
  },
  {
    id: "blocked-plugin",
    outcome: "incompatible",
    devMode: true,
    installed: { version: "1.8.3", display: "1.8.3" },
    blocked: { version: "1.9.0", reasons: ["requires bb >= 0.15"] },
  },
];

describe("checkPluginUpdates", () => {
  it("returns the checked entries across outcome kinds", async () => {
    const entries = await checkPluginUpdates(
      fetchReturning({ results: UPDATES_RESULTS }),
      { id: "updatable-plugin" },
    );
    expect(entries.map((entry) => entry.outcome)).toEqual([
      "current",
      "update-available",
      "incompatible",
    ]);
    expect(entries[1]?.candidate?.version).toBe("1.7.0");
    expect(entries[2]?.blocked?.reasons).toEqual(["requires bb >= 0.15"]);
  });

  it("throws on a malformed 2xx body", async () => {
    await expect(
      checkPluginUpdates(fetchReturning({ checked: true })),
    ).rejects.toThrow(/unrecognized update-check result/);
  });
});

describe("applyPluginUpdate", () => {
  it("POSTs an empty body and parses the apply result", async () => {
    const { fetchImpl, calls } = recordingFetch({
      applied: true,
      from: { version: "1.6.2", display: "1.6.2" },
      to: { version: "1.7.0", display: "1.7.0" },
      outcome: "updated",
    });
    const result = await applyPluginUpdate(fetchImpl, "linear");
    expect(result).toEqual({
      applied: true,
      outcome: "updated",
      from: { version: "1.6.2", display: "1.6.2" },
      to: { version: "1.7.0", display: "1.7.0" },
      detail: null,
    });
    expect(calls[0]?.init?.body).toBe("{}");
  });

  it("throws on a malformed 2xx body instead of defaulting to success", async () => {
    await expect(
      applyPluginUpdate(fetchReturning({ status: "done" }), "linear"),
    ).rejects.toThrow(/unrecognized update result/);
  });
});

describe("installPlugin", () => {
  it("throws on a malformed 2xx body instead of treating it as installed", async () => {
    await expect(
      installPlugin(fetchReturning({ installed: true }), {
        source: "npm:x",
      }),
    ).rejects.toThrow(/unrecognized install result/);
  });
});

describe("removeMarketplace", () => {
  it("DELETEs without a body and returns the converted plugin ids", async () => {
    const { fetchImpl, calls } = recordingFetch({
      convertedPluginIds: ["datadog", "todoist"],
    });
    const result = await removeMarketplace(fetchImpl, "acme");
    expect(result).toEqual({ convertedPluginIds: ["datadog", "todoist"] });
    expect(calls[0]?.url).toBe("/api/v1/marketplaces/acme");
    expect(calls[0]?.init).toEqual({ method: "DELETE" });
  });

  it("throws the server message on a refused removal", async () => {
    await expect(
      removeMarketplace(fetchReturning({ error: "unknown marketplace" }, 422), "acme"),
    ).rejects.toThrow("unknown marketplace");
  });

  it("throws on a malformed 2xx body instead of defaulting to removed", async () => {
    await expect(
      removeMarketplace(fetchReturning({ kept: [] }), "acme"),
    ).rejects.toThrow(/unrecognized removal result/);
  });
});

describe("marketplace parsers", () => {
  it("maps MarketplaceView fields, keeping displayName distinct from the id", async () => {
    const items = await fetchMarketplaces(
      fetchReturning({
        marketplaces: [
          {
            id: "acme",
            name: "acme",
            displayName: "Acme Tools",
            source: "https://github.com/acme/bb-marketplace@main",
            resolvedCommit: "9e12f04aa00c",
            pluginCount: 11,
            lastRefreshAt: 1752300000000,
            lastError: "fetch failed",
          },
        ],
      }),
    );
    expect(items).toEqual([
      {
        id: "acme",
        name: "acme",
        displayName: "Acme Tools",
        source: "https://github.com/acme/bb-marketplace@main",
        resolvedCommit: "9e12f04aa00c",
        pluginCount: 11,
        lastRefreshAt: 1752300000000,
        lastAttemptAt: null,
        lastError: "fetch failed",
      },
    ]);
  });

  it("returns [] for a malformed marketplaces envelope", async () => {
    expect(
      await fetchMarketplaces(fetchReturning({ marketplaces: "corrupt" })),
    ).toEqual([]);
    expect(await fetchMarketplaces(fetchReturning(null))).toEqual([]);
  });

  it("drops rows missing required MarketplaceView fields instead of defaulting them", async () => {
    const items = await fetchMarketplaces(
      fetchReturning({
        marketplaces: [{ id: "half", name: "half", displayName: "Half" }],
      }),
    );
    expect(items).toEqual([]);
  });

  it("parses MarketplaceSearchResult with the real compatible/source fields", async () => {
    const entries = await searchMarketplaces(
      fetchReturning({
        results: [
          {
            marketplaceId: "acme",
            entryId: "todoist",
            displayName: "Todoist",
            description: "Personal task capture",
            category: "Project management",
            source: "npm:@acme/bb-plugin-todoist",
            installed: false,
            compatible: false,
            incompatibleReason: "requires bb >= 0.15",
          },
        ],
      }),
      "todo",
    );
    expect(entries).toEqual([
      {
        marketplaceId: "acme",
        entryId: "todoist",
        displayName: "Todoist",
        description: "Personal task capture",
        category: "Project management",
        source: "npm:@acme/bb-plugin-todoist",
        installed: false,
        compatible: false,
        incompatibleReason: "requires bb >= 0.15",
      },
    ]);
  });
});
