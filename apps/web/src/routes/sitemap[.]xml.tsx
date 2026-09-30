import { createFileRoute } from "@tanstack/react-router";

import { POSTS } from "../blog/posts.js";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import { sitemapXml } from "../server/sitemap.js";

declare const __SITE_ORIGIN__: string;

async function serveSitemap(): Promise<Response> {
  const marketplace = await getPublicMarketplace();
  return new Response(sitemapXml(__SITE_ORIGIN__, POSTS, marketplace), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export const Route = createFileRoute("/sitemap.xml")({
  server: { handlers: { GET: serveSitemap, HEAD: serveSitemap } },
});
