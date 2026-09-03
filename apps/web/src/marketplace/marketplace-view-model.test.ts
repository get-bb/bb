import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  filterMarketplaceCategories,
  filterMarketplaceEntries,
  marketplaceAuthorEntries,
  marketplaceCategoryOptions,
  marketplaceInstallCommand,
  marketplaceInstallSource,
  marketplaceRepositoryLabel,
  marketplaceShelves,
  moreInMarketplaceCategory,
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

  it("adds category counts in document order", () => {
    expect(
      marketplaceCategoryOptions(
        MARKETPLACE_V2_FIXTURE,
        MARKETPLACE_V2_FIXTURE.plugins,
      ),
    ).toEqual([
      { id: "thread-content", label: "Thread Content", count: 1 },
      { id: "code-and-reviews", label: "Code & Reviews", count: 2 },
      { id: "uncategorized", label: "More plugins", count: 1 },
    ]);
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

  it("builds repository and install source labels", () => {
    const npmEntry = MARKETPLACE_V2_FIXTURE.plugins[0];
    const gitEntry = MARKETPLACE_V2_FIXTURE.plugins[1];
    if (npmEntry === undefined || gitEntry === undefined) {
      throw new Error("The fixture needs two plugins");
    }
    expect(marketplaceRepositoryLabel(npmEntry)).toBe(
      "package/@get-bb/plugin-prompt-library",
    );
    expect(marketplaceInstallSource(npmEntry)).toBe("npm, ^1.2.0");
    expect(marketplaceRepositoryLabel(gitEntry)).toBe("acme/bb-plugins");
    expect(marketplaceInstallSource(gitEntry)).toBe("git tag, >=1.0.0 <2.0.0");
  });

  it("orders category recommendations by install count", () => {
    const current = MARKETPLACE_V2_FIXTURE.plugins[1];
    const prompt = MARKETPLACE_V2_FIXTURE.plugins[0];
    if (current === undefined || prompt === undefined) {
      throw new Error("The fixture needs two plugins");
    }
    const manifest = {
      ...MARKETPLACE_V2_FIXTURE,
      plugins: [
        current,
        { ...prompt, category: "code-and-reviews" },
        ...MARKETPLACE_V2_FIXTURE.plugins.slice(2),
      ],
    };
    expect(
      moreInMarketplaceCategory(
        manifest,
        current,
        MARKETPLACE_STATS_FIXTURE,
      ).map((entry) => entry.id),
    ).toEqual(["prompt-library", "review-notes"]);
  });
});
