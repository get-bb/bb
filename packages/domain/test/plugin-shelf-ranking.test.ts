import { describe, expect, it } from "vitest";
import {
  rankPluginShelf,
  type PluginShelfRankingSignals,
} from "../src/plugin-shelf-ranking.js";

const now = Date.parse("2026-10-10T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

const plugin = (
  id: string,
  signals: Partial<Omit<PluginShelfRankingSignals, "id">> = {},
): PluginShelfRankingSignals => ({ id, recentInstalls: null, ...signals });

const rank = (entries: readonly PluginShelfRankingSignals[]) =>
  rankPluginShelf(entries, (entry) => entry, now).map((entry) => entry.id);

describe("rankPluginShelf", () => {
  it("decays trending installs by age so a younger plugin outranks a bigger, older one", () => {
    expect(
      rank([
        plugin("veteran", { recentInstalls: 300, publishedAt: daysAgo(90) }),
        plugin("riser", { recentInstalls: 40, publishedAt: daysAgo(10) }),
      ]),
    ).toEqual(["riser", "veteran"]);
  });

  it("requires five recent installs to trend and orders the rest newest first", () => {
    expect(
      rank([
        plugin("undated"),
        plugin("old-quiet", { recentInstalls: 0, publishedAt: daysAgo(200) }),
        plugin("blip", { recentInstalls: 4, publishedAt: daysAgo(1) }),
        plugin("trending", { recentInstalls: 5, publishedAt: daysAgo(120) }),
        plugin("launched", { publishedAt: daysAgo(0.5) }),
      ]),
    ).toEqual(["trending", "launched", "blip", "old-quiet", "undated"]);
  });

  it("falls back to newest first without recent install data", () => {
    expect(
      rank([
        plugin("b", { publishedAt: daysAgo(5) }),
        plugin("old", { publishedAt: daysAgo(50) }),
        plugin("a", { publishedAt: daysAgo(5) }),
        plugin("new", { publishedAt: daysAgo(1) }),
      ]),
    ).toEqual(["new", "a", "b", "old"]);
  });
});
