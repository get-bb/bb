import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/og/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { docsOgResponse } = await import("../docs/docs-og-route");
        return docsOgResponse(params._splat ?? "");
      },
    },
  },
});
