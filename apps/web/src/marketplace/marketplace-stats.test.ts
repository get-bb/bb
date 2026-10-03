import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  marketplaceEntryInstalls,
  marketplaceInstallDisplay,
} from "./marketplace-model.js";
import { parseMarketplaceStats } from "./marketplace-stats.js";

describe("marketplace install stats", () => {
  it("reads install counts only from the stats sidecar", () => {
    const [counted, uncounted] = MARKETPLACE_V2_FIXTURE.plugins;
    expect(marketplaceEntryInstalls(counted!, MARKETPLACE_STATS_FIXTURE)).toBe(
      1_204,
    );
    expect(
      marketplaceEntryInstalls(uncounted!, MARKETPLACE_STATS_FIXTURE),
    ).toBeUndefined();
    expect(counted).not.toHaveProperty("installCount");
  });

  it("drops malformed plugin ids and rejects invalid counts", () => {
    expect(
      parseMarketplaceStats({
        ...MARKETPLACE_STATS_FIXTURE,
        plugins: {
          ...MARKETPLACE_STATS_FIXTURE.plugins,
          "future-plugin": { installs: 2, futureField: true },
          "Bad Plugin": { installs: 99 },
        },
      }),
    ).toMatchObject({
      plugins: {
        "prompt-library": { installs: 1_204 },
        "future-plugin": { installs: 2 },
      },
    });
    expect(() =>
      parseMarketplaceStats({
        ...MARKETPLACE_STATS_FIXTURE,
        plugins: { "prompt-library": { installs: -1 } },
      }),
    ).toThrow();
  });

  it("labels recent low-count plugins new until they age out", () => {
    const [entry] = MARKETPLACE_V2_FIXTURE.plugins;
    const now = Date.parse("2026-10-02T00:00:00Z");
    const stats = (installs: number) => ({
      ...MARKETPLACE_STATS_FIXTURE,
      plugins: { [entry!.id]: { installs } },
    });
    const recent = { ...entry!, publishedAt: "2026-09-20T00:00:00Z" };
    const old = { ...entry!, publishedAt: "2026-08-01T00:00:00Z" };
    expect(marketplaceInstallDisplay(recent, stats(25), now)).toBe(25);
    expect(marketplaceInstallDisplay(recent, stats(3), now)).toBe("new");
    expect(marketplaceInstallDisplay(recent, null, now)).toBe("new");
    expect(marketplaceInstallDisplay(old, stats(3), now)).toBe(3);
    expect(marketplaceInstallDisplay(old, null, now)).toBeNull();
  });
});
