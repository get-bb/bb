import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import { CONTENT_PATHS, GUIDE_LINKS, GUIDE_MENU } from "./content-links";
import { LANDING_PAGES } from "./landing-pages";
import { landingPagePath } from "./landing-template";

describe("CONTENT_PATHS", () => {
  it("links every comparison, guide, and landing page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/guides/${guide.slug}`),
      ...LANDING_PAGES.map(landingPagePath),
    ];
    expect([...CONTENT_PATHS].sort()).toEqual(pages.sort());
  });

  it("names each guide link with the guide's title", () => {
    for (const link of GUIDE_LINKS) {
      const guide = GUIDES.find((item) => `/guides/${item.slug}` === link.href);
      expect(link.label).toBe(guide?.title);
    }
  });

  it("puts every guide in the header's Guides menu", () => {
    const menuHrefs = GUIDE_MENU.flatMap((item) =>
      "links" in item ? item.links.map((link) => link.href) : [item.href],
    );
    for (const link of GUIDE_LINKS) {
      expect(menuHrefs).toContain(link.href);
    }
  });
});
