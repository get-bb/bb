import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import type { ComponentProps } from "react";

import landingCss from "../landing/landing.css?url";
import { unfurlMeta } from "../landing/site.js";
import marketplaceCss from "../marketplace/marketplace.css?url";
import { getPublicMarketplace } from "../marketplace/marketplace-server.js";
import {
  PublicMarketplaceNotFoundPage,
  PublicMarketplacePage,
  PublicMarketplaceUnavailablePage,
} from "../marketplace/public-marketplace.js";
import {
  isMarketplaceSort,
  parseMarketplaceCategories,
} from "../marketplace/marketplace-view-model.js";

const PAGE_TITLE = "Plugin Marketplace — bb";
const PAGE_DESCRIPTION = "Find community plugins that add new features to bb.";

function validateMarketplaceSearch(search: Record<string, unknown>) {
  return {
    category: parseMarketplaceCategories(search.category),
    ...(isMarketplaceSort(search.sort) ? { sort: search.sort } : {}),
  };
}

export const Route = createFileRoute("/marketplace_")({
  validateSearch: validateMarketplaceSearch,
  loader: () => getPublicMarketplace(),
  head: ({ loaderData, match, matches }) => {
    const available = loaderData?.status === "available";
    const lastMatch = matches.at(-1);
    const isIndex = lastMatch?.routeId === match.routeId;
    const notFound = matches.some(
      (candidate) => candidate.status === "notFound",
    );
    const sharedLinks: Array<ComponentProps<"link">> = [
      {
        rel: "preload",
        href: interWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "stylesheet", href: landingCss },
      { rel: "stylesheet", href: marketplaceCss },
    ];
    if (notFound) {
      return {
        meta: [
          { title: "Page not found — bb" },
          { name: "robots", content: "noindex" },
        ],
        links: sharedLinks,
      };
    }
    if (!isIndex) return { links: sharedLinks };
    return {
      meta: [
        { title: PAGE_TITLE },
        { name: "description", content: PAGE_DESCRIPTION },
        { name: "robots", content: available ? "index, follow" : "noindex" },
        ...unfurlMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/marketplace"),
      ],
      links: [
        ...sharedLinks,
        { rel: "canonical", href: "https://getbb.app/marketplace" },
      ],
    };
  },
  notFoundComponent: PublicMarketplaceNotFoundPage,
  component: MarketplaceRoute,
});

function MarketplaceRoute() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const marketplace = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  if (path !== "/marketplace" && path !== "/marketplace/") return <Outlet />;
  if (marketplace.status === "unavailable") {
    return <PublicMarketplaceUnavailablePage />;
  }
  return (
    <PublicMarketplacePage
      manifest={marketplace.manifest}
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
