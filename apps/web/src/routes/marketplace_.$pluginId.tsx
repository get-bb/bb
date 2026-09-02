import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { unfurlMeta } from "../landing/site.js";
import {
  PublicMarketplaceDetailPage,
  PublicMarketplaceUnavailablePage,
} from "../marketplace/public-marketplace.js";

const marketplaceRoute = getRouteApi("/marketplace_");

export const Route = createFileRoute("/marketplace_/$pluginId")({
  loader: async ({ params, parentMatchPromise }) => {
    const { loaderData: marketplace } = await parentMatchPromise;
    if (marketplace === undefined || marketplace.status === "unavailable") {
      return null;
    }
    const entry = marketplace.manifest.plugins.find(
      (candidate) => candidate.id === params.pluginId,
    );
    if (entry === undefined) throw notFound();
    return entry;
  },
  head: ({ loaderData, params }) => {
    const entry = loaderData;
    const title = entry
      ? `${entry.displayName} — bb Plugin Marketplace`
      : "Plugin Marketplace — bb";
    const description = entry?.description ?? "Find community plugins for bb.";
    const path = `/marketplace/${encodeURIComponent(params.pluginId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: entry ? "index, follow" : "noindex" },
        ...unfurlMeta(title, description, path),
      ],
      links: [{ rel: "canonical", href: `https://getbb.app${path}` }],
    };
  },
  component: MarketplaceDetailRoute,
});

function MarketplaceDetailRoute() {
  const marketplace = marketplaceRoute.useLoaderData();
  const entry = Route.useLoaderData();
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  if (entry === null) return null;
  return (
    <PublicMarketplaceDetailPage
      manifest={marketplace.manifest}
      entry={entry}
      stats={marketplace.stats}
    />
  );
}
