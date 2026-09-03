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
    expect(html).toContain("Make bb yours.");
    expect(html).toContain(
      "Themes, providers, workflows, and tools, installed with one command.",
    );
    expect(html).toContain("New &amp; notable");
    expect(html).toContain("More plugins");
    expect(html).toContain("Featured");
    expect(html).toContain("Popular");
    expect(html).toContain("marketplace-shelf-notable");
    expect(html).toContain("marketplace-new-chip");
    expect(html).toContain("https://github.com/get-bb.png?size=32");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("https://getbb.app/marketplace/v1/icons");
    expect(html).not.toContain("marketplace-category-pill");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("mask-image");
  });

  it("renders the detail route with install, trust, and image policy", () => {
    const entry = MARKETPLACE_V2_FIXTURE.plugins[0];
    const html = renderToStaticMarkup(
      <PublicMarketplaceDetailPage
        manifest={MARKETPLACE_V2_FIXTURE}
        entry={entry}
        stats={MARKETPLACE_STATS_FIXTURE}
      />,
    );
    expect(html).toContain("Marketplace</a>");
    expect(html).toContain("Thread Content</a>");
    expect(html).toContain("bb plugin install prompt-library");
    expect(html).toContain("Get bb for macOS");
    expect(html).toContain("Runs in bb&#x27;s terminal");
    expect(html).toContain("Details");
    expect(html).toContain("Trust");
    expect(html).toContain("npm, ^1.2.0");
    expect(html).toContain("Listed");
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("More from BB Labs");
    expect(html).not.toContain("About");
    expect(html.split(entry.description)).toHaveLength(2);
    expect(html).not.toContain("Version");
    expect(html).not.toContain("Updated");
  });

  it("renders author and category recommendations on a detail route", () => {
    const entry = MARKETPLACE_V2_FIXTURE.plugins[1];
    if (entry === undefined) {
      throw new Error("The fixture needs a second plugin");
    }
    const html = renderToStaticMarkup(
      <PublicMarketplaceDetailPage
        manifest={MARKETPLACE_V2_FIXTURE}
        entry={entry}
        stats={MARKETPLACE_STATS_FIXTURE}
      />,
    );
    expect(html).toContain("More from Acme");
    expect(html).toContain("Review Notes");
    expect(html).toContain("More in Code &amp; Reviews");
    expect(html).toContain("git tag, &gt;=1.0.0 &lt;2.0.0");
    expect(html).not.toContain("marketplace-screenshots");
    expect(html).not.toContain("About");
  });

  it("puts category recommendations in an otherwise empty content column", () => {
    const source = MARKETPLACE_V2_FIXTURE.plugins[1];
    if (source === undefined) {
      throw new Error("The fixture needs a second plugin");
    }
    const entry = {
      ...source,
      id: "solo-review",
      displayName: "Solo Review",
      author: { name: "Solo Reviewer", github: "solo-reviewer" },
    };
    const html = renderToStaticMarkup(
      <PublicMarketplaceDetailPage
        manifest={{
          ...MARKETPLACE_V2_FIXTURE,
          plugins: [...MARKETPLACE_V2_FIXTURE.plugins, entry],
        }}
        entry={entry}
        stats={MARKETPLACE_STATS_FIXTURE}
      />,
    );
    const related = html.indexOf("marketplace-detail-related is-in-layout");
    const aside = html.indexOf("marketplace-detail-aside");
    expect(related).toBeGreaterThan(-1);
    expect(aside).toBeGreaterThan(related);
    expect(html).toContain("More in Code &amp; Reviews");
    expect(html).not.toContain("marketplace-detail-content");
    expect(html).not.toContain("More from Solo Reviewer");
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
    expect(html).toContain("2 plugins in the Marketplace");
    expect(html).toContain("https://github.com/acme-tools.png?size=64");
    expect(html).toContain("https://github.com/acme-tools");
    expect(html).toContain("Search plugins");
    expect(html).toContain("Featured");
    expect(html).toContain("Popular");
    expect(html).toContain("Review Companion");
  });

  it("renders the unavailable route", () => {
    const html = renderToStaticMarkup(<PublicMarketplaceUnavailablePage />);
    expect(html).toContain("The Marketplace is not available");
    expect(html).toContain("Try again later");
  });
});
