import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { unfurlMeta } from "../landing/site.js";
import { MARKETPLACE_PUBLISH_PATH } from "../marketplace/marketplace-view-model.js";
import { PublicMarketplacePublishPage } from "../marketplace/marketplace-publish.js";

const marketplaceRoute = getRouteApi("/marketplace_");

const TITLE = "Publish a plugin — bb Plugin Marketplace";
const DESCRIPTION =
  "List your bb plugin in the Marketplace: add the bb-plugin GitHub topic or npm keyword, release, and it appears within about 30 minutes.";

export const Route = createFileRoute("/marketplace_/publish")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "index, follow" },
      ...unfurlMeta(TITLE, DESCRIPTION, MARKETPLACE_PUBLISH_PATH),
    ],
  }),
  component: MarketplacePublishRoute,
});

function MarketplacePublishRoute() {
  const marketplace = marketplaceRoute.useLoaderData();
  return (
    <PublicMarketplacePublishPage
      manifest={
        marketplace.status === "available" ? marketplace.manifest : null
      }
    />
  );
}
