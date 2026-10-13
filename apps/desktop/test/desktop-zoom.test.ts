import { describe, expect, it } from "vitest";
import { nextZoomFactor } from "../src/desktop-zoom.js";

describe("nextZoomFactor", () => {
  it("steps by 10 percent and resets to 100 percent", () => {
    expect(nextZoomFactor(1, "in")).toBe(1.1);
    expect(nextZoomFactor(1.1, "out")).toBe(1);
    expect(nextZoomFactor(2.3, "reset")).toBe(1);
  });

  it("clamps between 50 and 300 percent", () => {
    expect(nextZoomFactor(0.5, "out")).toBe(0.5);
    expect(nextZoomFactor(3, "in")).toBe(3);
    expect(nextZoomFactor(0.3, "in")).toBe(0.5);
  });

  it("snaps an off-grid factor onto the 10 percent grid", () => {
    expect(nextZoomFactor(1.0954451150103321, "in")).toBe(1.2);
    expect(nextZoomFactor(0.9999999999999999, "in")).toBe(1.1);
  });
});
