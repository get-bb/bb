import { describe, expect, it } from "vitest";
import {
  applyPluginUpdate,
  checkPluginUpdates,
  fetchMarketplaces,
  fetchPluginUpdateHistory,
  fetchPluginUpdates,
  ignorePluginVersion,
  installPlugin,
  searchMarketplaces,
  setMarketplaceAutoPolicy,
  setPluginAutoApply,
  setPluginUpdatePolicy,
} from "./plugin-marketplace-queries";

function fetchReturning(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
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
    id: "pinned-plugin",
    outcome: "pinned",
    installed: { version: "2.0.1", display: "2.0.1" },
  },
  {
    id: "blocked-plugin",
    outcome: "incompatible",
    devMode: true,
    installed: { version: "1.8.3", display: "1.8.3" },
    blocked: { version: "1.9.0", reasons: ["requires bb >= 0.15"] },
  },
  {
    id: "broken-plugin",
    outcome: "unavailable",
    installed: { version: "0.1.0", display: "0.1.0" },
    detail: "registry unreachable",
  },
];

describe("fetchPluginUpdates", () => {
  it("parses the { results } envelope across every outcome kind and derives view fields", async () => {
    const entries = await fetchPluginUpdates(
      fetchReturning({ results: UPDATES_RESULTS }),
    );
    expect(entries.map((entry) => entry.outcome)).toEqual([
      "current",
      "update-available",
      "pinned",
      "incompatible",
      "unavailable",
    ]);
    const updatable = entries[1];
    expect(updatable?.availableVersion).toBe("1.7.0");
    expect(updatable?.blockedVersion).toBeNull();
    const blocked = entries[3];
    expect(blocked?.availableVersion).toBeNull();
    expect(blocked?.blockedVersion).toBe("1.9.0");
    expect(blocked?.devMode).toBe(true);
    expect(blocked?.blocked?.reasons).toEqual(["requires bb >= 0.15"]);
    expect(entries[4]?.detail).toBe("registry unreachable");
  });

  it("returns [] for the old { updates } envelope instead of misparsing", async () => {
    expect(
      await fetchPluginUpdates(fetchReturning({ updates: UPDATES_RESULTS })),
    ).toEqual([]);
  });
});

describe("checkPluginUpdates", () => {
  it("returns the checked entries", async () => {
    const entries = await checkPluginUpdates(
      fetchReturning({ results: UPDATES_RESULTS }),
      { id: "updatable-plugin" },
    );
    expect(entries).toHaveLength(5);
  });

  it("throws on a malformed 2xx body", async () => {
    await expect(
      checkPluginUpdates(fetchReturning({ checked: true })),
    ).rejects.toThrow(/unrecognized update-check result/);
  });
});

describe("applyPluginUpdate", () => {
  it("parses the exact apply result", async () => {
    const result = await applyPluginUpdate(
      fetchReturning({
        applied: true,
        dryRun: false,
        from: { version: "1.6.2", display: "1.6.2" },
        to: { version: "1.7.0", display: "1.7.0" },
        outcome: "updated",
      }),
      "linear",
    );
    expect(result).toEqual({
      applied: true,
      dryRun: false,
      outcome: "updated",
      from: { version: "1.6.2", display: "1.6.2" },
      to: { version: "1.7.0", display: "1.7.0" },
      detail: null,
    });
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

describe("ignorePluginVersion", () => {
  it("resolves when the server echoes the ignored version", async () => {
    await expect(
      ignorePluginVersion(
        fetchReturning({ ignoredVersion: "1.7.0" }),
        "linear",
        "1.7.0",
      ),
    ).resolves.toBeUndefined();
  });

  it("throws on a malformed 2xx body", async () => {
    await expect(
      ignorePluginVersion(fetchReturning({ ok: true }), "linear", "1.7.0"),
    ).rejects.toThrow(/unrecognized ignore-version result/);
  });

  it("throws when the echoed version differs from the requested one", async () => {
    await expect(
      ignorePluginVersion(
        fetchReturning({ ignoredVersion: "1.6.0" }),
        "linear",
        "1.7.0",
      ),
    ).rejects.toThrow(/unrecognized ignore-version result/);
  });
});

describe("setPluginUpdatePolicy", () => {
  it("resolves when the server echoes the requested policy", async () => {
    await expect(
      setPluginUpdatePolicy(
        fetchReturning({ policy: "patch" }),
        "linear",
        "patch",
      ),
    ).resolves.toBeUndefined();
  });

  it("throws on a malformed 2xx body", async () => {
    await expect(
      setPluginUpdatePolicy(fetchReturning({ ok: true }), "linear", "manual"),
    ).rejects.toThrow(/unrecognized update-policy result/);
  });

  it("throws when the echoed policy differs from the requested one", async () => {
    await expect(
      setPluginUpdatePolicy(
        fetchReturning({ policy: "compatible" }),
        "linear",
        "manual",
      ),
    ).rejects.toThrow(/unrecognized update-policy result/);
  });
});

describe("setPluginAutoApply", () => {
  it("resolves when the server echoes the requested persisted value", async () => {
    await expect(
      setPluginAutoApply(fetchReturning({ autoApply: true }), "linear", true),
    ).resolves.toBeUndefined();
  });

  it("throws when the echo differs from the request (persisted the opposite)", async () => {
    await expect(
      setPluginAutoApply(fetchReturning({ autoApply: false }), "linear", true),
    ).rejects.toThrow(/unrecognized auto-apply result/);
  });

  it("throws on a malformed 2xx body", async () => {
    await expect(
      setPluginAutoApply(fetchReturning({ ok: true }), "linear", true),
    ).rejects.toThrow(/unrecognized auto-apply result/);
  });
});

describe("setMarketplaceAutoPolicy", () => {
  it("resolves when the server echoes both requested flags", async () => {
    await expect(
      setMarketplaceAutoPolicy(
        fetchReturning({ autoCheck: true, autoApply: false }),
        "acme",
        { autoCheck: true, autoApply: false },
      ),
    ).resolves.toBeUndefined();
  });

  it("throws when either echoed flag differs from the request", async () => {
    await expect(
      setMarketplaceAutoPolicy(
        fetchReturning({ autoCheck: true, autoApply: true }),
        "acme",
        { autoCheck: true, autoApply: false },
      ),
    ).rejects.toThrow(/unrecognized auto-policy result/);
  });
});

describe("fetchPluginUpdateHistory", () => {
  it("parses events, dropping half-shaped rows instead of defaulting them", async () => {
    const events = await fetchPluginUpdateHistory(
      fetchReturning({
        events: [
          {
            kind: "rollback",
            fromVersion: "1.7.0",
            toVersion: "1.6.2",
            outcome: "rolled-back",
            detail: "failed to start",
            at: 1752300000000,
          },
          { kind: "check", outcome: "current" }, // no `at` → drops
        ],
      }),
      "linear",
    );
    expect(events).toEqual([
      {
        kind: "rollback",
        fromVersion: "1.7.0",
        toVersion: "1.6.2",
        outcome: "rolled-back",
        detail: "failed to start",
        at: 1752300000000,
      },
    ]);
  });

  it("returns null (unavailable) on a non-2xx or unshaped response", async () => {
    expect(
      await fetchPluginUpdateHistory(fetchReturning({}, 404), "linear"),
    ).toBeNull();
    expect(
      await fetchPluginUpdateHistory(fetchReturning({ ok: true }), "linear"),
    ).toBeNull();
  });
});

describe("marketplace parsers (landed Phase 4 shapes)", () => {
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
            enabled: true,
            scope: "user",
            autoCheck: true,
            autoApply: false,
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
        enabled: true,
        scope: "user",
        autoCheck: true,
        autoApply: false,
      },
    ]);
  });

  it("drops rows missing required MarketplaceView fields instead of defaulting them", async () => {
    const items = await fetchMarketplaces(
      fetchReturning({
        marketplaces: [{ id: "half", name: "half", displayName: "Half" }],
      }),
    );
    expect(items).toEqual([]);
  });

  it("drops rows missing the Phase 6 policy fields instead of inventing a policy", async () => {
    const items = await fetchMarketplaces(
      fetchReturning({
        marketplaces: [
          {
            id: "old",
            name: "old",
            displayName: "Old Server",
            source: "/tmp/catalog",
            pluginCount: 1,
            enabled: true,
            // no scope/autoCheck/autoApply
          },
        ],
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
