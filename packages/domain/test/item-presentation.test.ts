import { describe, expect, it } from "vitest";
import { isPresentationTintColor } from "../src/index.js";

describe("isPresentationTintColor", () => {
  it("accepts hex, functional and named colours, trimming whitespace", () => {
    for (const value of [
      "#1d4ed8",
      "#fff",
      "#93c5fd80",
      "rgb(29, 78, 216)",
      "hsl(220 80% 50% / 0.5)",
      "oklch(0.62 0.2 260)",
      "color(display-p3 0.2 0.4 0.9)",
      "rebeccapurple",
      "  #fff  ",
    ]) {
      expect(isPresentationTintColor(value), value).toBe(true);
    }
  });

  it("refuses anything that is not a colour token", () => {
    for (const value of [
      "url(javascript:1)",
      "var(--ink)",
      "expression(alert(1))",
      "#ggg",
      "red; background: url(x)",
      "",
      "a",
    ]) {
      expect(isPresentationTintColor(value), value).toBe(false);
    }
  });
});
