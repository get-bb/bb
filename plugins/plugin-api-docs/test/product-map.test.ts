import { describe, expect, it } from "vitest";

import { annotationNeighbors } from "../src/product-map";
import { SURFACE_GROUPS } from "../src/surfaces";

describe("annotationNeighbors", () => {
  const surfaces = SURFACE_GROUPS[0]!.surfaces;

  it("moves through annotations in their authored numeric order", () => {
    expect(annotationNeighbors(surfaces, surfaces[1]!.id)).toEqual({
      previous: surfaces[0],
      next: surfaces[2],
    });
  });

  it("keeps the missing direction disabled at each endpoint", () => {
    expect(annotationNeighbors(surfaces, surfaces[0]!.id)).toEqual({
      previous: null,
      next: surfaces[1],
    });
    expect(annotationNeighbors(surfaces, surfaces.at(-1)!.id)).toEqual({
      previous: surfaces.at(-2),
      next: null,
    });
  });
});
