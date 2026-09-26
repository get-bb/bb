import { describe, expect, it } from "vitest";

import { parsePost } from "../blog/parse-post.js";
import { MARKETPLACE_V2_FIXTURE } from "../marketplace/marketplace-v2.fixture.js";
import { sitemapXml } from "./sitemap.js";

const post = parsePost(
  "an-agentic-ide",
  "---\ntitle: An agentic IDE\ndate: 2026-08-20\nlede: A post.\n---\nBody.\n",
);

describe("sitemapXml", () => {
  it("lists public pages, posts, plugins, and unique authors with update dates", () => {
    const xml = sitemapXml("https://getbb.app", [post], {
      status: "available",
      manifest: MARKETPLACE_V2_FIXTURE,
      stats: null,
    });

    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    for (const path of [
      "/",
      "/blog",
      "/changelog",
      "/privacy",
      "/marketplace",
      "/blog/an-agentic-ide",
      "/marketplace/prompt-library",
      "/marketplace/review-companion",
      "/marketplace/author/get-bb",
      "/marketplace/author/acme-tools",
    ]) {
      expect(xml).toContain(`<loc>https://getbb.app${path}</loc>`);
    }
    expect(xml).toContain("<lastmod>2026-08-20</lastmod>");
    expect(xml).toContain("<lastmod>2026-08-24T16:45:00+02:00</lastmod>");
    expect(
      xml.match(
        /<loc>https:\/\/getbb\.app\/marketplace\/author\/get-bb<\/loc>/gu,
      ),
    ).toHaveLength(1);
    expect(xml).not.toContain("/dashboard");
    expect(xml).not.toContain("/marketplace/v2/");
  });

  it("omits unavailable marketplace pages", () => {
    const xml = sitemapXml("https://getbb.app", [post], {
      status: "unavailable",
    });

    expect(xml).toContain("<loc>https://getbb.app/blog/an-agentic-ide</loc>");
    expect(xml).not.toContain("/marketplace");
  });
});
