import { describe, expect, it } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  entriesByMarketplaceAuthor,
  pluginMarketplaceAuthorKey,
} from "./plugin-marketplace-author";

function entry(
  marketplace: string,
  author: PluginCatalogSearchEntry["author"],
  pluginId: string,
) {
  return { marketplace, author, pluginId };
}

describe("plugin marketplace author identity", () => {
  it("matches GitHub logins without using the display name", () => {
    const selected = entry(
      "first",
      { name: "Pat Lee", url: "https://github.com/PatLee" },
      "selected",
    );
    const sameLogin = entry(
      "first",
      { name: "Patricia Lee", url: "https://www.github.com/patlee/" },
      "same-login",
    );
    const otherMarketplace = entry(
      "second",
      { name: "Patricia Lee", url: "https://github.com/patlee" },
      "other-marketplace",
    );
    const sameName = entry(
      "first",
      { name: "Pat Lee", url: null },
      "same-name",
    );
    const key = pluginMarketplaceAuthorKey(selected);

    expect(key).toBe("5:first:github:patlee");
    if (key === null) throw new Error("Expected an author key");
    expect(
      entriesByMarketplaceAuthor(
        [selected, sameLogin, otherMarketplace, sameName],
        key,
      ),
    ).toEqual([selected, sameLogin]);
  });

  it("uses an exact name when a GitHub login is not present", () => {
    const selected = entry("first", { name: "BB", url: null }, "selected");
    const sameName = entry(
      "first",
      { name: "BB", url: "https://bb.dev" },
      "same-name",
    );
    const differentCase = entry(
      "first",
      { name: "bb", url: null },
      "different-case",
    );
    const githubName = entry(
      "first",
      { name: "BB", url: "https://github.com/get-bb" },
      "github-name",
    );
    const key = pluginMarketplaceAuthorKey(selected);

    expect(key).toBe("5:first:name:BB");
    if (key === null) throw new Error("Expected an author key");
    expect(
      entriesByMarketplaceAuthor(
        [selected, sameName, differentCase, githubName],
        key,
      ),
    ).toEqual([selected, sameName]);
  });
});
