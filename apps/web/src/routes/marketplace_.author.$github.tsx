import { createFileRoute, notFound } from "@tanstack/react-router";

import { unfurlMeta } from "../landing/site.js";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import {
  PublicMarketplaceAuthorPage,
  PublicMarketplaceUnavailablePage,
} from "../marketplace/public-marketplace.js";
import { marketplaceAuthorEntries } from "../marketplace/marketplace-view-model.js";

export const Route = createFileRoute("/marketplace_/author/$github")({
  loader: async ({ params }) => {
    const marketplace = await getPublicMarketplace();
    if (marketplace.status === "unavailable") return marketplace;
    const entries = marketplaceAuthorEntries(
      marketplace.manifest,
      params.github,
    );
    if (entries.length === 0) throw notFound();
    return { ...marketplace, entries };
  },
  head: ({ loaderData, params }) => {
    const author =
      loaderData?.status === "available"
        ? loaderData.entries[0]?.author
        : undefined;
    const title = author
      ? `${author.name} plugins — bb Plugin Marketplace`
      : "Plugin author — bb Plugin Marketplace";
    const description = author
      ? `Find bb plugins from ${author.name}.`
      : "Find community plugins for bb.";
    const path = `/marketplace/author/${encodeURIComponent(params.github)}`;
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
  const marketplace = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  return (
    <PublicMarketplaceAuthorPage
      manifest={marketplace.manifest}
      entries={marketplace.entries}
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
