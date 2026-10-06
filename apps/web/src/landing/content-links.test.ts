import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import { CONTENT_PATHS } from "./content-links";

describe("CONTENT_PATHS", () => {
  it("links every comparison and guide page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/${guide.section}/${guide.slug}`),
    ];
    expect([...CONTENT_PATHS].sort()).toEqual(pages.sort());
  });
});
