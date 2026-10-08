import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CHANGELOG_ENTRIES,
  RELEASE_META,
} from "@/components/settings/changelog-preview";
import { ReleaseVisual } from "./ReleaseVisual";
import { RELEASE_VISUALS } from "./release-visuals";

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?)\(/i;

describe("release visuals", () => {
  it("resolves every visual named in release metadata", () => {
    const referenced = Object.entries(RELEASE_META).flatMap(
      ([version, meta]) =>
        meta.visual === undefined ? [] : [[version, meta.visual] as const],
    );
    expect(referenced.length).toBeGreaterThan(0);
    for (const [version, visual] of referenced) {
      expect(RELEASE_VISUALS[visual], `${version} → ${visual}`).toBeDefined();
    }
  });

  it("uses every registered drawing for a release", () => {
    const used = new Set<string | undefined>(
      Object.values(RELEASE_META).map((meta) => meta.visual),
    );
    expect(Object.keys(RELEASE_VISUALS).filter((id) => !used.has(id))).toEqual(
      [],
    );
  });

  it("has a visual for the newest release", () => {
    const newest = CHANGELOG_ENTRIES[0]?.version ?? "";
    expect(RELEASE_META[newest]?.visual).toBeDefined();
  });

  it("draws decorative art from theme tokens only", () => {
    for (const visual of Object.keys(RELEASE_VISUALS) as Array<
      keyof typeof RELEASE_VISUALS
    >) {
      const markup = renderToStaticMarkup(<ReleaseVisual visual={visual} />);
      expect(markup, visual).toContain('aria-hidden="true"');
      expect(markup, visual).not.toMatch(LITERAL_COLOR);
    }
  });

  it("renders nothing for a release without a visual", () => {
    expect(renderToStaticMarkup(<ReleaseVisual visual={undefined} />)).toBe("");
  });
});
