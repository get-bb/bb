// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATE_PLUGIN_PROMPT } from "@bb/client-core";
import {
  BROWSE_ARCHETYPES,
  UTILITY_EXAMPLES,
  archetypePrompt,
} from "./browse-hero-archetypes";
import { BrowseArchetypeCards } from "./BrowseArchetypeCards";
import { BrowseHeroCarousel } from "./BrowseHeroCarousel";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { MINI_APP_SCENES } from "./MiniAppScenes";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";

afterEach(() => {
  cleanup();
});

function renderCarousel(element: ReactElement) {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientWrapper>{children}</QueryClientWrapper>
      </MemoryRouter>
    );
  }
  return render(element, { wrapper: TestWrapper });
}

describe("BrowseHeroCarousel", () => {
  it("has a scene for every archetype", () => {
    for (const archetype of BROWSE_ARCHETYPES) {
      expect(MINI_APP_SCENES[archetype.id]).toBeTypeOf("function");
    }
  });

  it("dresses the shared engine in plugin copy, not another surface's", () => {
    renderCarousel(<BrowseHeroCarousel autoplay={false} />);

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toContain("Turn bb into");
    expect(heading.textContent).toContain(BROWSE_ARCHETYPES[0]?.noun);
    expect(screen.getByText("Plugin")).toBeTruthy();
    expect(
      screen.getByRole("tablist", { name: "Plugin examples" }),
    ).toBeTruthy();
  });

  it("moves between slides from the tablist and wraps at both ends", () => {
    renderCarousel(<BrowseHeroCarousel autoplay={false} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(BROWSE_ARCHETYPES.length);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ tabs[0] as HTMLElement,
      { key: "ArrowRight" },
    );
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ screen.getAllByRole(
        "tab",
      )[1] as HTMLElement,
      {
        key: "ArrowLeft",
      },
    );
    fireEvent.keyDown(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ screen.getAllByRole(
        "tab",
      )[0] as HTMLElement,
      {
        key: "ArrowLeft",
      },
    );
    const last = BROWSE_ARCHETYPES.length - 1;
    expect(
      screen.getAllByRole("tab")[last]?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("opens blank-seeded and closes through the openRequest channel", () => {
    const { rerender } = renderCarousel(
      <BrowseHeroCarousel autoplay={false} openRequest={null} />,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Describe the plugin you want to build…"]',
      ),
    ).toBeNull();

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 1, seed: CREATE_PLUGIN_PROMPT }}
      />,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Describe the plugin you want to build…"]',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 2, close: true }}
      />,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Describe the plugin you want to build…"]',
      ),
    ).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(BROWSE_ARCHETYPES.length);
  });

  it("reports composing transitions exactly once each", () => {
    const onComposingChange = vi.fn();
    const { rerender } = renderCarousel(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={null}
        onComposingChange={onComposingChange}
      />,
    );

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 1, seed: CREATE_PLUGIN_PROMPT }}
        onComposingChange={onComposingChange}
      />,
    );
    expect(onComposingChange).toHaveBeenCalledTimes(1);
    expect(onComposingChange).toHaveBeenLastCalledWith(true);

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 2, close: true }}
        onComposingChange={onComposingChange}
      />,
    );
    expect(onComposingChange).toHaveBeenCalledTimes(2);
    expect(onComposingChange).toHaveBeenLastCalledWith(false);
  });

  it("opens and re-seeds from external requests, ignoring stale nonces", () => {
    const first = BROWSE_ARCHETYPES[0]!;
    const second = BROWSE_ARCHETYPES[1]!;
    const { rerender } = renderCarousel(
      <BrowseHeroCarousel autoplay={false} openRequest={null} />,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Describe the plugin you want to build…"]',
      ),
    ).toBeNull();

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 1, seed: archetypePrompt(first) }}
      />,
    );
    expect(document.body.textContent).toContain(archetypePrompt(first));

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 2, seed: archetypePrompt(second) }}
      />,
    );
    expect(document.body.textContent).toContain(archetypePrompt(second));

    rerender(
      <BrowseHeroCarousel
        autoplay={false}
        openRequest={{ nonce: 2, seed: archetypePrompt(second) }}
      />,
    );
    expect(document.body.textContent).toContain(archetypePrompt(second));
  });

  it("ignores open requests while the composer is disabled for stories", () => {
    renderCarousel(
      <BrowseHeroCarousel
        autoplay={false}
        composerDisabled
        openRequest={{ nonce: 1, seed: CREATE_PLUGIN_PROMPT }}
      />,
    );
    expect(
      document.querySelector(
        '[data-placeholder="Describe the plugin you want to build…"]',
      ),
    ).toBeNull();
  });
});

describe("BrowseArchetypeCards", () => {
  it("seeds a use-case card's full prompt through onCreate", () => {
    const onCreate = vi.fn();
    render(
      <TooltipProvider>
        <BrowseArchetypeCards onCreate={onCreate} />
      </TooltipProvider>,
    );

    const target = BROWSE_ARCHETYPES[2]!;
    fireEvent.click(screen.getByText(target.title));

    expect(onCreate).toHaveBeenCalledWith(archetypePrompt(target));
  });

  it("seeds a utility example's prompt and shows both tiers", () => {
    const onCreate = vi.fn();
    render(
      <TooltipProvider>
        <BrowseArchetypeCards onCreate={onCreate} />
      </TooltipProvider>,
    );

    for (const archetype of BROWSE_ARCHETYPES) {
      expect(screen.getByText(archetype.title)).toBeTruthy();
    }
    for (const example of UTILITY_EXAMPLES) {
      expect(screen.getByText(example.label)).toBeTruthy();
    }

    const utility = UTILITY_EXAMPLES[3]!;
    fireEvent.click(screen.getByText(utility.label));
    expect(onCreate).toHaveBeenCalledWith(
      `${CREATE_PLUGIN_PROMPT}${utility.brief}.`,
    );
  });
});
