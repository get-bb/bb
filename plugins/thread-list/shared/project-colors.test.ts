import { describe, expect, it } from "vitest";
import {
  isProjectColorId,
  PROJECT_COLOR_IDS,
  PROJECT_COLOR_PALETTE,
  projectColorCss,
  projectColorIdForProject,
  resolveProjectColorId,
} from "./project-colors.js";

describe("project colors", () => {
  it("assigns a stable palette color from a project id", () => {
    for (const projectId of ["proj_a", "proj_personal", "proj_9f2k"]) {
      expect(projectColorIdForProject(projectId)).toBe(
        projectColorIdForProject(projectId),
      );
      expect(PROJECT_COLOR_IDS).toContain(projectColorIdForProject(projectId));
    }
  });

  it("spreads sample ids across more than one palette entry", () => {
    const ids = new Set(
      Array.from({ length: 64 }, (_, index) =>
        projectColorIdForProject(`proj_${index}`),
      ),
    );
    expect(ids.size).toBeGreaterThan(4);
  });

  it("keeps the palette ids unique", () => {
    expect(new Set(PROJECT_COLOR_IDS).size).toBe(PROJECT_COLOR_IDS.length);
    expect(PROJECT_COLOR_PALETTE).toHaveLength(PROJECT_COLOR_IDS.length);
  });

  it("prefers a valid override and ignores unknown stored values", () => {
    expect(resolveProjectColorId("proj_a", { proj_a: "violet" })).toBe(
      "violet",
    );
    expect(resolveProjectColorId("proj_a", { proj_a: "chartreuse" })).toBe(
      projectColorIdForProject("proj_a"),
    );
    expect(resolveProjectColorId("proj_a", {})).toBe(
      projectColorIdForProject("proj_a"),
    );
  });

  it("builds a theme-aware color expression from the palette", () => {
    for (const color of PROJECT_COLOR_PALETTE) {
      const css = projectColorCss(color.id);
      expect(css).toContain("color-mix(in oklch,");
      expect(css).toContain(` ${color.hue})`);
      expect(css).toContain("var(--ink)");
      expect(css).toContain("light-dark(");
    }
  });

  it("rejects values outside the palette", () => {
    expect(isProjectColorId("rose")).toBe(true);
    expect(isProjectColorId("neon")).toBe(false);
    expect(isProjectColorId(null)).toBe(false);
  });
});
