import type { Post } from "../blog/parse-post.js";
import type { PublicMarketplaceData } from "../marketplace/marketplace-data.js";

interface SitemapPage {
  path: string;
  lastmod?: string;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

export function sitemapXml(
  origin: string,
  posts: readonly Post[],
  marketplace: PublicMarketplaceData,
): string {
  const pages: SitemapPage[] = [
    { path: "/" },
    { path: "/blog" },
    { path: "/changelog" },
    { path: "/privacy" },
    ...posts.map((post) => ({
      path: `/blog/${encodeURIComponent(post.slug)}`,
      lastmod: post.dateIso,
    })),
  ];

  if (marketplace.status === "available") {
    pages.push({ path: "/marketplace" });
    for (const plugin of marketplace.manifest.plugins) {
      pages.push({
        path: `/marketplace/${encodeURIComponent(plugin.id)}`,
        lastmod: plugin.updatedAt ?? plugin.publishedAt,
      });
    }
    const authors = new Set(
      marketplace.manifest.plugins.flatMap((plugin) =>
        plugin.author.github === undefined ? [] : [plugin.author.github],
      ),
    );
    for (const author of authors) {
      pages.push({ path: `/marketplace/author/${encodeURIComponent(author)}` });
    }
  }

  const urls = pages
    .map(
      ({ path, lastmod }) =>
        `  <url><loc>${escapeXml(`${origin}${path}`)}</loc>${lastmod === undefined ? "" : `<lastmod>${escapeXml(lastmod)}</lastmod>`}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
