import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { docsLlms, slugsFromMarkdownPath, source } =
          await import("../docs/source");
        const page = source.getPage(slugsFromMarkdownPath(params._splat ?? ""));
        if (!page) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(await docsLlms.page(page), {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        });
      },
    },
  },
});
