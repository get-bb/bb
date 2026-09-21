// @vitest-environment jsdom

import { PluginCardAuthor } from "./PluginCard";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import {
  PluginMarketplaceListingSections,
  PluginMoreFromAuthorSection,
  PluginMarketplaceSource,
} from "./PluginMarketplaceListing";

function catalogEntry(pluginId: string): PluginCatalogSearchEntry {
  return {
    entryId: pluginId,
    pluginId,
    displayName: pluginId,
    description: `${pluginId} description`,
    icon: "Zap",
    iconUrl: null,
    iconTinted: false,
    screenshots: [],
    collections: [],
    source: `npm:${pluginId}`,
    repositoryUrl: null,
    marketplace: "bb-community",
    marketplaceDisplayName: "BB Community",
    publisherKey: "bb-community",
    publisherLabel: "BB Community",
    official: true,
    author: {
      name: "Pat Lee",
      github: "patlee",
      url: "https://github.com/patlee",
    },
    installed: false,
    installs: null,
    compatible: true,
    incompatibleReason: null,
  };
}

afterEach(cleanup);

describe("plugin marketplace author links", () => {
  it("preserves the description, Overview, and listing metadata", () => {
    const overview =
      "## Requirements\n\nKeep the complete instructions.\n\n```sh\nbb secret request TOKEN\n```";
    render(
      <PluginMarketplaceListingSections
        entry={{
          ...catalogEntry("Secrets"),
          description: "Securely request credentials.",
          overview,
          publishedAt: "2026-07-09T12:00:00Z",
          categoryId: "security",
          category: "Security & Privacy",
        }}
      />,
    );
    expect(screen.getByText("Securely request credentials.")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: /^(About|Description)$/u }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Overview", level: 2 }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Requirements", level: 3 }),
    ).toBeTruthy();
    expect(screen.getByText("bb secret request TOKEN")).toBeTruthy();
    expect(screen.getByText("Listed").parentElement?.textContent).toContain(
      "Jul 9, 2026",
    );
    expect(screen.queryByText("Last updated")).toBeNull();
    expect(
      screen.getByText("Marketplace").parentElement?.textContent,
    ).toContain("BB Community");
    const grid = screen.getByText("Marketplace").closest("dl");
    expect(
      Array.from(
        grid?.querySelectorAll("dt") ?? [],
        (label) => label.textContent,
      ),
    ).toEqual(["Marketplace", "Listed"]);
    expect(
      screen.getByRole("heading", { name: "Details" }).parentElement
        ?.textContent,
    ).toContain("Security & Privacy");
  });

  it("does not create an empty Overview for a description-only plugin", () => {
    render(<PluginMarketplaceListingSections entry={catalogEntry("Local")} />);
    expect(screen.getByText("Local description")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
  });

  it("routes the detail author name to the author page", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/Current?category=security"]}>
        <PluginCardAuthor entry={catalogEntry("Current")} />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/^By/u)).toBeNull();
    expect(
      screen.getByRole("link", { name: "Pat Lee" }).getAttribute("href"),
    ).toBe(
      "/plugins?category=security&author=12%3Abb-community%3Agithub%3Apatlee",
    );
  });

  it("excludes the current plugin and caps related cards at four", () => {
    const current = catalogEntry("Current");
    const entries = [
      current,
      catalogEntry("Echo"),
      catalogEntry("Delta"),
      catalogEntry("Charlie"),
      catalogEntry("Bravo"),
      catalogEntry("Alpha"),
      {
        ...catalogEntry("Other"),
        author: { name: "Other", github: null, url: null },
      },
    ];
    const onOpenPlugin = vi.fn();
    render(
      <MemoryRouter>
        <PluginMoreFromAuthorSection
          entry={current}
          catalogEntries={entries}
          onOpenPlugin={onOpenPlugin}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "More from this author" }),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("button", { name: /^Open .+ details$/u })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Open Alpha details",
      "Open Bravo details",
      "Open Charlie details",
      "Open Delta details",
    ]);
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByText("Echo")).toBeNull();
    expect(screen.queryByText("Other")).toBeNull();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(screen.queryByText(/trusted|official|installed/iu)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Alpha details" }));
    expect(onOpenPlugin).toHaveBeenCalledWith("Alpha");
  });
});

describe("plugin source presentation", () => {
  it("links bundled plugins to the BB repository without catalog repository metadata", () => {
    render(
      <PluginMarketplaceSource
        entry={{ source: "builtin:automations", repositoryUrl: null }}
      />,
    );
    const link = screen.getByRole("link", { name: /github.com\/get-bb\/bb/u });
    expect(link.getAttribute("href")).toBe("https://github.com/get-bb/bb");
    expect(link.querySelector('[data-icon="GithubLogo"]')).not.toBeNull();
  });

  it("preserves a listing's specific source path", () => {
    const url = "https://github.com/example/plugins/tree/HEAD/plugins/review";
    render(
      <PluginMarketplaceSource
        entry={{
          source: "git:https://github.com/example/plugins.git@main",
          repositoryUrl: url,
        }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(url);
  });
});
