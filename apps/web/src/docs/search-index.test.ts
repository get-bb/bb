import { docsSearchIndexSchema } from "@bb/domain/docs-search-index";
import { describe, expect, it } from "vitest";

import { docsSearchIndexFromSource } from "./search-index";
import { source } from "./source";

describe("docs search index", () => {
  it("builds an index from the docs source that the bb CLI's schema accepts", async () => {
    const served = JSON.parse(
      JSON.stringify(await docsSearchIndexFromSource()),
    );

    const index = docsSearchIndexSchema.parse(served);

    expect(index.pages.map((page) => page.url).sort()).toEqual(
      source
        .getPages()
        .map((page) => page.url)
        .sort(),
    );
    const configuration = index.pages.find(
      (page) =>
        page.url === "/docs/configuration-files-and-environment-variables",
    );
    expect(configuration?.sections).toContainEqual(
      expect.objectContaining({
        anchor: expect.any(String),
        text: expect.stringContaining("BB_DOCS_URL"),
      }),
    );
  }, 60_000);
});
