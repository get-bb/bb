import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SurfaceCard, SURFACE_GROUPS } from "../src/index";

const surfaces = SURFACE_GROUPS[0]!.surfaces;

describe("SurfaceCard annotation navigation", () => {
  it("places compact previous and next actions on opposite card edges", () => {
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
    expect(markup).toMatch(
      /data-annotation-navigation-side="left"[^>]*class="[^"]*left-1\.5/,
    );
    expect(markup).toMatch(
      /data-annotation-navigation-side="right"[^>]*class="[^"]*right-1\.5/,
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
