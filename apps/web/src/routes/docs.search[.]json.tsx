import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/docs/search.json")({
  server: {
    handlers: {
      GET: async () => (await import("../docs/server")).docsSearch.staticGET(),
    },
  },
});
