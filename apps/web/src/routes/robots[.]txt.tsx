import { createFileRoute } from "@tanstack/react-router";

declare const __SITE_ORIGIN__: string;

function serveRobots(): Response {
  return new Response(
    `User-agent: *\nAllow: /\nSitemap: ${__SITE_ORIGIN__}/sitemap.xml\n`,
    {
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}

export const Route = createFileRoute("/robots.txt")({
  server: { handlers: { GET: serveRobots, HEAD: serveRobots } },
});
