// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginAuthorPage } from "./PluginAuthorPage";

function catalogEntry(
  pluginId: string,
  overrides: Partial<PluginCatalogSearchEntry> = {},
): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId,
    description: `${pluginId} description`,
    icon: "Zap",
    iconUrl: null,
    iconTinted: false,
    categoryId: "thread-content",
    category: "Thread Content",
    screenshots: [],
    collections: [],
    publishedAt: "2026-08-01T00:00:00Z",
    source: `npm:${pluginId}`,
    repositoryUrl: null,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: true,
    author: { name: "Pat Lee", url: "https://github.com/patlee" },
    installed: false,
    installs: 10,
    compatible: true,
    incompatibleReason: null,
    ...overrides,
  };
}

const ALPHA = catalogEntry("Alpha", { installs: null });
const BETA = catalogEntry("Beta", {
  author: { name: "Patricia Lee", url: "https://github.com/PatLee" },
  categoryId: "security",
  category: "Security",
  publishedAt: "2026-08-20T00:00:00Z",
  installs: 50,
});
const GAMMA = catalogEntry("Gamma", {
  publishedAt: undefined,
  installs: 100,
});
const OTHER = catalogEntry("Other", {
  author: { name: "Pat Lee", url: null },
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

function cardOrder(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Open "][aria-label$=" details"]',
    ),
  ].map((button) => button.getAttribute("aria-label") ?? "");
}

function renderPage(initialEntry: string, onOpenPlugin = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [GAMMA, OTHER, BETA, ALPHA],
            collections: [],
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PluginAuthorPage
        authorKey="12:bb-community:github:patlee"
        onInstall={() => undefined}
        onOpenPlugin={onOpenPlugin}
      />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
  return onOpenPlugin;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginAuthorPage", () => {
  it("restores the URL and shows only the selected author's plugins", async () => {
    renderPage(
      "/extensions/plugins?author=12%3Abb-community%3Agithub%3Apatlee&sort=recently-added&direction=asc",
    );

    expect(
      await screen.findByRole("heading", { name: /^Pat Lee/u }),
    ).toBeTruthy();
    expect(screen.getByText("3 plugins")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /github\.com\/patlee/u })
        .getAttribute("href"),
    ).toBe("https://github.com/patlee");
    expect(cardOrder()).toEqual([
      "Open Alpha details",
      "Open Beta details",
      "Open Gamma details",
    ]);
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.getByTestId("location").textContent).toContain(
      "author=12%3Abb-community%3Agithub%3Apatlee",
    );
  });

  it("applies search, multiple categories, and both optional-value sorts", async () => {
    const onOpenPlugin = renderPage(
      "/extensions/plugins?author=12%3Abb-community%3Agithub%3Apatlee&sort=most-installed",
    );

    await screen.findByRole("heading", { name: /^Pat Lee/u });
    expect(cardOrder()).toEqual([
      "Open Gamma details",
      "Open Beta details",
      "Open Alpha details",
    ]);
    const sort = screen.getByRole("button", {
      name: "Sort: Most installed, descending",
    });
    fireEvent.pointerDown(sort);
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: "Most installed" }),
    );
    expect(cardOrder()).toEqual([
      "Open Beta details",
      "Open Gamma details",
      "Open Alpha details",
    ]);
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Thread Content/u }));
    expect(cardOrder()).toEqual(["Open Gamma details", "Open Alpha details"]);
    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    expect(cardOrder()).toEqual([
      "Open Beta details",
      "Open Gamma details",
      "Open Alpha details",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));

    fireEvent.change(screen.getByRole("textbox", { name: "Search plugins" }), {
      target: { value: "Beta" },
    });
    expect(cardOrder()).toEqual(["Open Beta details"]);
    const beta = screen.getByRole("button", { name: "Open Beta details" });
    fireEvent.click(beta);
    expect(onOpenPlugin).toHaveBeenCalledWith("Beta", beta);
    expect(screen.getByTestId("location").textContent).toContain("query=Beta");
  });
});
