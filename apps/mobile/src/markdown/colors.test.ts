import { describe, expect, it } from "vitest";
import { blendOver, withAlpha } from "./colors";

describe("withAlpha", () => {
  it("handles every token format the generated theme emits", () => {
    expect(withAlpha("#dcdde5", 0.7)).toBe("rgba(220, 221, 229, 0.7)");
    expect(withAlpha("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
    expect(withAlpha("#ffffff80", 0.5)).toBe("rgba(255, 255, 255, 0.251)");
    expect(withAlpha("rgba(76, 79, 105, 0.06)", 0.5)).toBe(
      "rgba(76, 79, 105, 0.03)",
    );
    expect(withAlpha("rgb(1, 2, 3)", 0.25)).toBe("rgba(1, 2, 3, 0.25)");
    expect(withAlpha("transparent", 0.5)).toBe("transparent");
  });
});

describe("blendOver", () => {
  it("composites the overlay at its alpha onto the base", () => {
    expect(blendOver("#ffffff", "#000000", 0.5)).toBe("rgb(128, 128, 128)");
    expect(blendOver("#000", "rgba(255, 255, 255, 0.5)", 0.5)).toBe(
      "rgb(64, 64, 64)",
    );
    expect(blendOver("#ffffff", "#000000", 0)).toBe("rgb(255, 255, 255)");
  });

  it("returns the base when a color cannot be parsed", () => {
    expect(blendOver("#ffffff", "oklch(0 0 0)", 0.5)).toBe("#ffffff");
  });
});
