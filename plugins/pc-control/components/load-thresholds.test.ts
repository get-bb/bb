import { describe, expect, it } from "vitest";
import {
  LOAD_THRESHOLDS,
  levelBarClass,
  levelStrokeClass,
  loadLevel,
} from "./load-thresholds.js";

describe("load thresholds", () => {
  it("keeps the documented boundaries in one place", () => {
    expect(LOAD_THRESHOLDS).toEqual({ warningPercent: 85, criticalPercent: 95 });
  });

  it("classifies load at and around the boundaries", () => {
    expect(loadLevel(0)).toBe("normal");
    expect(loadLevel(84.9)).toBe("normal");
    expect(loadLevel(85)).toBe("warning");
    expect(loadLevel(94.9)).toBe("warning");
    expect(loadLevel(95)).toBe("critical");
    expect(loadLevel(100)).toBe("critical");
  });

  it("treats missing data as neutral", () => {
    expect(loadLevel(null)).toBe("normal");
  });

  it("maps levels to distinct visual classes", () => {
    const classes = ["normal", "warning", "critical"].map((level) =>
      levelBarClass(level as "normal"),
    );
    expect(new Set(classes).size).toBe(3);
    expect(levelStrokeClass("critical")).toBe("stroke-destructive");
    expect(levelStrokeClass("warning")).toBe("stroke-warning");
    expect(levelStrokeClass("normal")).toBe("stroke-primary");
  });
});
