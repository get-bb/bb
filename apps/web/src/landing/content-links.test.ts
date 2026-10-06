import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import { CONTENT_PATHS, GUIDE_LINKS } from "./content-links";

describe("CONTENT_PATHS", () => {
  it("links every comparison and guide page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/guides/${guide.slug}`),
    ];
    expect([...CONTENT_PATHS].sort()).toEqual(pages.sort());
  });

  it("names each guide link with the guide's title", () => {
    for (const link of GUIDE_LINKS) {
      const guide = GUIDES.find((item) => `/guides/${item.slug}` === link.href);
      expect(link.label).toBe(guide?.title);
    }
  });
});
