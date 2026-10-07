import { describe, expect, it } from "vitest";

import { COMPARISONS } from "../compare/comparisons";
import { GUIDES } from "../guides/guides";
import { CLAUDE_CODE_MOBILE_PATH } from "./claude-code-mobile";
import { CONTENT_PATHS } from "./content-links";

describe("CONTENT_PATHS", () => {
  it("links every comparison, guide, and landing page exactly once", () => {
    const pages = [
      ...COMPARISONS.map((comparison) => `/compare/${comparison.slug}`),
      ...GUIDES.map((guide) => `/${guide.section}/${guide.slug}`),
      CLAUDE_CODE_MOBILE_PATH,
    ];
    expect([...CONTENT_PATHS].sort()).toEqual(pages.sort());
  });
});
