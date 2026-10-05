import { createFileRoute } from "@tanstack/react-router";
import { getEnv } from "@/server/env";
import { serveMarketplaceObject } from "@/server/marketplace";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import { serveMarketplaceOg } from "../marketplace/marketplace-og.js";

const loadMarketplaceAsset = (url: string) =>
  new URL(url).origin === "https://getbb.app"
    ? serveMarketplaceObject({
        bucket: getEnv().MARKETPLACE,
        request: new Request(url),
      })
    : fetch(url, { signal: AbortSignal.timeout(5000) });

export const Route = createFileRoute("/marketplace/og/$pluginId")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        serveMarketplaceOg(
          await getPublicMarketplace(),
          params.pluginId,
          loadMarketplaceAsset,
        ),
    },
  },
});
