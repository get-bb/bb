import { createFileRoute } from "@tanstack/react-router";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import { serveMarketplaceOg } from "../marketplace/marketplace-og.js";

export const Route = createFileRoute("/marketplace/og/$pluginId")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        serveMarketplaceOg(await getPublicMarketplace(), params.pluginId),
    },
  },
});
