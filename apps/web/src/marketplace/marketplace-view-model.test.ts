import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  filterMarketplaceCategories,
  filterMarketplaceEntries,
  marketplaceAuthorEntries,
  marketplaceInstallCommand,
  marketplaceShelves,
  parseMarketplaceCategories,
  sortMarketplaceEntries,
} from "./marketplace-view-model.js";

describe("public marketplace view model", () => {
  it("orders collections, document categories, and More plugins", () => {
    const shelves = marketplaceShelves(MARKETPLACE_V2_FIXTURE);
    expect(shelves.map((shelf) => shelf.label)).toEqual([
      "New & notable",
      "Thread Content",
      "Code & Reviews",
      "More plugins",
    ]);
    expect(shelves[0]?.entries.map((entry) => entry.id)).toEqual([
      "review-companion",
      "prompt-library",
    ]);
    expect(shelves.at(-1)?.entries.map((entry) => entry.id)).toEqual([
      "orphan-tool",
    ]);
  });

  it("sorts undated and uncounted entries last", () => {
    expect(
      sortMarketplaceEntries(
        MARKETPLACE_V2_FIXTURE.plugins,
        "recently-added",
        MARKETPLACE_STATS_FIXTURE,
      ).map((entry) => entry.id),
    ).toEqual([
      "review-companion",
      "prompt-library",
      "orphan-tool",
      "review-notes",
    ]);
    expect(
      sortMarketplaceEntries(
        MARKETPLACE_V2_FIXTURE.plugins,
        "most-installed",
        MARKETPLACE_STATS_FIXTURE,
      ).map((entry) => entry.id),
    ).toEqual([
      "prompt-library",
      "orphan-tool",
      "review-companion",
      "review-notes",
    ]);
  });

  it("sorts published dates by their actual time", () => {
    const first = MARKETPLACE_V2_FIXTURE.plugins[0];
    const second = MARKETPLACE_V2_FIXTURE.plugins[1];
    if (first === undefined || second === undefined) {
      throw new Error("The fixture needs two plugins");
    }
    expect(
      sortMarketplaceEntries(
        [
          { ...first, publishedAt: "2026-08-20T12:00:00+02:00" },
          { ...second, publishedAt: "2026-08-20T11:00:00Z" },
        ],
        "recently-added",
        MARKETPLACE_STATS_FIXTURE,
      ).map((entry) => entry.id),
    ).toEqual([second.id, first.id]);
  });

  it("searches copy and filters more than one category", () => {
    expect(
      filterMarketplaceEntries(
        MARKETPLACE_V2_FIXTURE,
        MARKETPLACE_V2_FIXTURE.plugins,
        "Code & Reviews",
      ).map((entry) => entry.id),
    ).toEqual(["review-companion", "review-notes"]);
    expect(
      filterMarketplaceCategories(
        MARKETPLACE_V2_FIXTURE,
        MARKETPLACE_V2_FIXTURE.plugins,
        ["thread-content", "uncategorized"],
      ).map((entry) => entry.id),
    ).toEqual(["prompt-library", "orphan-tool"]);
  });

  it("parses repeatable category parameters and finds an author", () => {
    expect(
      parseMarketplaceCategories([
        "code-and-reviews",
        "thread-content",
        "code-and-reviews",
        "Bad Category",
      ]),
    ).toEqual(["code-and-reviews", "thread-content"]);
    expect(
      marketplaceAuthorEntries(MARKETPLACE_V2_FIXTURE, "ACME-TOOLS").map(
        (entry) => entry.id,
      ),
    ).toEqual(["review-companion", "review-notes"]);
    expect(marketplaceAuthorEntries(MARKETPLACE_V2_FIXTURE, "missing")).toEqual(
      [],
    );
  });

  it("builds the install command", () => {
    expect(marketplaceInstallCommand("prompt-library")).toBe(
      "bb plugin install prompt-library",
    );
  });
});
