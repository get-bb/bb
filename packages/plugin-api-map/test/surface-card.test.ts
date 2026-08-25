import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SurfaceCard, SURFACE_GROUPS } from "../src/index";

const surfaces = SURFACE_GROUPS[0]!.surfaces;

describe("SurfaceCard annotation navigation", () => {
  it("renders compact previous and next annotation actions", () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceCard, {
        surface: surfaces[1]!,
        number: 2,
        onDismiss: () => undefined,
        navigation: {
          previous: surfaces[0]!,
          next: surfaces[2]!,
          onOpen: () => undefined,
        },
      }),
    );

    expect(markup).toContain(
      `aria-label="Previous annotation: ${surfaces[0]!.title}"`,
    );
    expect(markup).toContain(
      `aria-label="Next annotation: ${surfaces[2]!.title}"`,
    );
  });

  it("keeps the unavailable endpoint visible and disabled", () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceCard, {
        surface: surfaces[0]!,
        number: 1,
        onDismiss: () => undefined,
        navigation: {
          previous: null,
          next: surfaces[1]!,
          onOpen: () => undefined,
        },
      }),
    );

    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="No previous annotation"/,
    );
  });

  it("renders the compact copy action when the host supplies copy behavior", () => {
    const markup = renderToStaticMarkup(
      createElement(SurfaceCard, {
        surface: surfaces[0]!,
        number: 1,
        onDismiss: () => undefined,
        onCopyForAgent: async () => true,
      }),
    );

    expect(markup).toContain("Copy for agent");
    expect(markup).not.toContain("bb-plugin-authoring skill");
  });
});
