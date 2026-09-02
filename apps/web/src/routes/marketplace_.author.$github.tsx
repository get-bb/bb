import { createFileRoute, getRouteApi, notFound } from "@tanstack/react-router";

import { unfurlMeta } from "../landing/site.js";
import {
  PublicMarketplaceAuthorPage,
  PublicMarketplaceUnavailablePage,
} from "../marketplace/public-marketplace.js";
import { marketplaceAuthorEntries } from "../marketplace/marketplace-view-model.js";

const marketplaceRoute = getRouteApi("/marketplace_");

export const Route = createFileRoute("/marketplace_/author/$github")({
  loader: async ({ params, parentMatchPromise }) => {
    const { loaderData: marketplace } = await parentMatchPromise;
    if (marketplace === undefined || marketplace.status === "unavailable") {
      return null;
    }
    const entries = marketplaceAuthorEntries(
      marketplace.manifest,
      params.github,
    );
    if (entries.length === 0) throw notFound();
    return entries;
  },
  head: ({ loaderData, params }) => {
    const author = loaderData?.[0]?.author;
    const title = author
      ? `${author.name} plugins — bb Plugin Marketplace`
      : "Plugin author — bb Plugin Marketplace";
    const description = author
      ? `Find bb plugins from ${author.name}.`
      : "Find community plugins for bb.";
    const github = author?.github ?? params.github;
    const path = `/marketplace/author/${encodeURIComponent(github)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: author ? "index, follow" : "noindex" },
        ...unfurlMeta(title, description, path),
      ],
      links: [{ rel: "canonical", href: `https://getbb.app${path}` }],
    };
  },
  component: MarketplaceAuthorRoute,
});

function MarketplaceAuthorRoute() {
  const marketplace = marketplaceRoute.useLoaderData();
  const entries = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  if (entries === null) return null;
  return (
    <PublicMarketplaceAuthorPage
      manifest={marketplace.manifest}
      entries={entries}
      stats={marketplace.stats}
      state={{ categories: search.category, sort: search.sort }}
      onStateChange={(next) =>
        void navigate({
          search: { category: next.categories, sort: next.sort },
        })
      }
    />
  );
}
