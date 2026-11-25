import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildIosTextSizeScript } from "./ios-text-size";

describe("iOS WebView text size", () => {
  it.each([
    [0.823, "0.823", "82.3%"],
    [1, "1", "100%"],
    [1.353, "1.353", "135.3%"],
    [3.571, "3.571", "357.1%"],
    [0, "1", "100%"],
    [-1, "1", "100%"],
    [NaN, "1", "100%"],
    [Infinity, "1", "100%"],
  ])(
    "maps native font scale %s to %s and %s",
    (fontScale, cssScale, cssAdjustment) => {
      const setProperty = vi.fn();
      const setAttribute = vi.fn();
      const removeAttribute = vi.fn();

      expect(
        runInNewContext(buildIosTextSizeScript(fontScale), {
          document: {
            documentElement: {
              style: { setProperty },
              setAttribute,
              removeAttribute,
            },
          },
        }),
      ).toBe(true);
      if (cssScale === "1") {
        expect(removeAttribute).toHaveBeenCalledWith("data-bb-ios-text-scale");
        expect(setAttribute).not.toHaveBeenCalled();
      } else {
        expect(setAttribute).toHaveBeenCalledWith(
          "data-bb-ios-text-scale",
          cssScale,
        );
        expect(removeAttribute).not.toHaveBeenCalled();
      }
      expect(setProperty).toHaveBeenCalledWith("--bb-ios-font-scale", cssScale);
      expect(setProperty).toHaveBeenCalledWith(
        "--bb-ios-text-size-adjust",
        cssAdjustment,
      );
    },
  );
});
