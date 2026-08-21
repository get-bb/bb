import { describe, expect, it } from "vitest";
import { createBrowserBbSdk } from "../src/browser.js";
import { createNodeBbSdk } from "../src/node.js";

/**
 * The type-level test in public-types.test.ts pins the *declared* shape of
 * each SDK. This one pins the runtime object: `createBbSdk` only attaches
 * `guide` when the factory passes one, so a regression that wired
 * `createGuideArea()` back into the shared core (and its ~112 KB of template
 * markdown back into the web app's boot chunk) fails here, not only in the
 * bundle-budget check after a full build.
 */
describe("guide area attachment", () => {
  it("attaches a working local guide to the Node SDK", () => {
    const sdk = createNodeBbSdk({ baseUrl: "http://server" });

    expect(Object.hasOwn(sdk, "guide")).toBe(true);
    expect(sdk.guide.render({ chapter: "threads" }).content).toContain(
      "thread",
    );
  });

  it("does not attach the guide to the browser SDK", () => {
    const sdk = createBrowserBbSdk({ baseUrl: "http://server" });

    expect(Object.hasOwn(sdk, "guide")).toBe(false);
    expect(typeof sdk.threads.list).toBe("function");
  });
});
