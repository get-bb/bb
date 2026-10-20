import { createFileRoute } from "@tanstack/react-router";

import { DocsHome } from "../docs/docs-home";
import docsCss from "../docs/docs.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: pageMeta("Docs — bb", "Learn how to extend bb with plugins.", "/docs"),
    links: siteHeadLinks(docsCss),
  }),
  component: DocsIndexRoute,
});

function DocsIndexRoute() {
  useInitAnalytics();
  return <DocsHome />;
}
