import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MARKETPLACE_STATS_FIXTURE,
  MARKETPLACE_V2_FIXTURE,
} from "./marketplace-v2.fixture.js";
import {
  PublicMarketplaceAuthorPage,
  PublicMarketplaceDetailPage,
  PublicMarketplacePage,
  PublicMarketplaceUnavailablePage,
} from "./public-marketplace.js";

describe("public marketplace route rendering", () => {
  it("renders the marketplace route with document shelves and controls", () => {
    const html = renderToStaticMarkup(
      <PublicMarketplacePage
        manifest={MARKETPLACE_V2_FIXTURE}
        stats={MARKETPLACE_STATS_FIXTURE}
        state={{ categories: [] }}
        onStateChange={() => {}}
      />,
    );
    expect(html).toContain("New &amp; notable");
    expect(html).toContain("More plugins");
    expect(html).toContain("Most installed");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("https://getbb.app/marketplace/v1/icons");
    expect(html).not.toContain("mask-image");
  });

  it("renders the detail route with install, metadata, and image policy", () => {
    const entry = MARKETPLACE_V2_FIXTURE.plugins[0];
    const html = renderToStaticMarkup(
      <PublicMarketplaceDetailPage
        manifest={MARKETPLACE_V2_FIXTURE}
        entry={entry}
        stats={MARKETPLACE_STATS_FIXTURE}
      />,
    );
    expect(html).toContain("bb plugin install prompt-library");
    expect(html).toContain("Get bb");
    expect(html).toContain("Listed");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("Updated");
  });

  it("renders the author route with the same toolbar", () => {
    const entries = MARKETPLACE_V2_FIXTURE.plugins.filter(
      (entry) => entry.author.github === "acme-tools",
    );
    const html = renderToStaticMarkup(
      <PublicMarketplaceAuthorPage
        manifest={MARKETPLACE_V2_FIXTURE}
        entries={entries}
        stats={MARKETPLACE_STATS_FIXTURE}
        state={{ categories: [] }}
        onStateChange={() => {}}
      />,
    );
    expect(html).toContain("Acme");
    expect(html).toContain("Search plugins");
    expect(html).toContain("Recently added");
    expect(html).toContain("Review Companion");
  });

  it("renders the unavailable route", () => {
    const html = renderToStaticMarkup(<PublicMarketplaceUnavailablePage />);
    expect(html).toContain("The Marketplace is not available");
    expect(html).toContain("Try again later");
  });
});
