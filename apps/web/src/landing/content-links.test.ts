import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import { LANDING_PAGE_PATHS } from "./agent-landing";
import { CONTENT_PATHS } from "./content-links";

describe("CONTENT_PATHS", () => {
  it("links every comparison, guide, and landing page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/${guide.section}/${guide.slug}`),
      ...Object.values(LANDING_PAGE_PATHS),
    ];
    expect([...CONTENT_PATHS].sort()).toEqual(pages.sort());
  });
});
