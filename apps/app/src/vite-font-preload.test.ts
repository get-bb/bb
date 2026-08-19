import { describe, expect, it } from "vitest";
import { resolveFontPreloadTags } from "../vite-font-preload.js";

const bundle = [
  "assets/index-rXrqkkAU.js",
  "assets/inter-latin-ext-wght-normal-BpKOsZoc.woff2",
  "assets/inter-latin-wght-italic-CX2R8fZt.woff2",
  "assets/inter-latin-wght-normal-Dx4kXJAl.woff2",
  "assets/inter-cyrillic-wght-normal-D26zlscB.woff2",
  "assets/index-CXWZ8ak3.css",
];

describe("resolveFontPreloadTags", () => {
  it("preloads only the Inter latin upright subset, as a CORS font request", () => {
    const tags = resolveFontPreloadTags(bundle, "/");

    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({
      tag: "link",
      injectTo: "head",
      attrs: {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        crossorigin: true,
        href: "/assets/inter-latin-wght-normal-Dx4kXJAl.woff2",
      },
    });
  });

  it("respects a non-root base", () => {
    const [tag] = resolveFontPreloadTags(bundle, "/app/");
    expect(tag.attrs?.href).toBe("/app/assets/inter-latin-wght-normal-Dx4kXJAl.woff2");
  });

  it("emits nothing when the font is not in the bundle", () => {
    expect(resolveFontPreloadTags(["assets/index-abc.js"], "/")).toEqual([]);
  });
});
