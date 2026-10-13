import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import {
  canonicalPath,
  contentPaths,
  guideLinks,
  guideMenu,
} from "./content-links";
import { LANDING_PAGES } from "./landing-pages";
import { landingPagePath } from "./landing-template";

describe("contentPaths", () => {
  it("links every comparison, guide, and landing page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/guides/${guide.slug}`).filter(
        (path) => canonicalPath(path) === path,
      ),
      ...LANDING_PAGES.map(landingPagePath),
    ];
    expect([...contentPaths()].sort()).toEqual(pages.sort());
  });

  it("names each guide link with the guide's title", () => {
    for (const link of guideLinks()) {
      const guide = GUIDES.find((item) => `/guides/${item.slug}` === link.href);
      expect(link.label).toBe(guide?.title);
    }
  });

  it("puts every guide in the header's Guides menu", () => {
    const menuHrefs = guideMenu().flatMap((item) =>
      "links" in item ? item.links.map((link) => link.href) : [item.href],
    );
    for (const link of guideLinks()) {
      expect(menuHrefs).toContain(link.href);
    }
  });
});
