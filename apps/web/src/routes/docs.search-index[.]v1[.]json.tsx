import { createFileRoute } from "@tanstack/react-router";

async function serveDocsSearchIndex(): Promise<Response> {
  const { docsSearchIndexFromSource } = await import("../docs/search-index");
  return Response.json(await docsSearchIndexFromSource());
}

export const Route = createFileRoute("/docs/search-index.v1.json")({
  server: {
    handlers: { GET: serveDocsSearchIndex, HEAD: serveDocsSearchIndex },
  },
});
