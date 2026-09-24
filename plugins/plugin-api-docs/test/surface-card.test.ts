import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { firstPartyPluginId } from "../src/plugin-icons";
import { SurfaceCard } from "../src/surface-card";
import { SURFACE_GROUPS } from "../src/surfaces";
import { SurfaceMapContext } from "../src/wireframes";

const surfaces = SURFACE_GROUPS[0]!.surfaces;

describe("SurfaceCard annotation navigation", () => {
  it("resolves every first-party example to a plugin in the first-party table", () => {
    const names = SURFACE_GROUPS.flatMap((group) =>
      group.surfaces.flatMap((surface) => surface.firstParty ?? []),
    );
    for (const name of new Set(names)) {
      expect(firstPartyPluginId(name), name).not.toBeNull();
    }
  });

  it("uses host-resolved provider artwork alongside its plugin link", () => {
    const markup = renderToStaticMarkup(
      createElement(
        SurfaceMapContext.Provider,
        {
          value: {
            activeId: null,
            expandedId: null,
            setActiveId: () => undefined,
            numberOf: () => null,
            pluginPageHref: () => "/plugins/provider-codex",
            renderPluginIcon: () =>
              createElement("img", { src: "/codex.svg", alt: "" }),
          },
        },
        createElement(SurfaceCard, {
          surface: { ...surfaces[1]!, firstParty: ["Codex provider"] },
          number: 2,
          onDismiss: () => undefined,
        }),
      ),
    );

    expect(markup).toMatch(
      /href="\/plugins\/provider-codex"[^>]*><img[^>]*src="\/codex.svg"/,
    );
    expect(markup).toContain("Codex provider");
  });

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
