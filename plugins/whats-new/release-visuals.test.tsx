import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseVisual } from "./release-visual.js";
import { RELEASE_VISUALS } from "./release-visuals.js";

const LITERAL_COLOR = /#[0-9a-f]{3,8}\b|\b(?:oklch|oklab|rgba?|hsla?)\(/i;

describe("release visuals", () => {
  it("draws decorative art from theme tokens only", () => {
    for (const visual of Object.keys(RELEASE_VISUALS) as Array<
      keyof typeof RELEASE_VISUALS
    >) {
      const markup = renderToStaticMarkup(<ReleaseVisual visual={visual} />);
      expect(markup, visual).toContain('aria-hidden="true"');
      expect(markup, visual).not.toMatch(LITERAL_COLOR);
    }
  });

  it("renders nothing for a release without a visual or with an unknown one", () => {
    expect(renderToStaticMarkup(<ReleaseVisual visual="retired-art" />)).toBe(
      "",
    );
    expect(renderToStaticMarkup(<ReleaseVisual visual={null} />)).toBe("");
  });
});
