import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import guidesCss from "../guides/guides.css?url";
import { breadcrumbJsonLd } from "../docs/breadcrumbs";
import { DOCS_OG_SIZE } from "../docs/docs-og-paths";
import { DocsPage } from "../docs/docs-page";
import docsCss from "../docs/docs.css?url";
import { pageMeta, siteHeadLinks } from "../landing/page-head";

const loadDocsPage = createServerFn({ method: "GET" })
  .validator((splat: string) => String(splat))
  .handler(async ({ data }) => {
    const { docsPageView } = await import("../docs/page-view");
    const view = await docsPageView(data);
    if (!view) {
      throw notFound();
    }
    return view;
  });

export const Route = createFileRoute("/docs/$")({
  staticData: { ownsCanonical: true },
  loader: async ({ params }) => {
    const view = await loadDocsPage({ data: params._splat ?? "" });
    if (view.kind === "mdx") {
      const { docs } = await import("../docs/content");
      await docs.getPage(view.contentPath)?.preload();
    }
    return view;
  },
  head: ({ loaderData }) =>
    loaderData
      ? {
          meta: pageMeta(
            `${loaderData.title} — bb docs`,
            loaderData.description,
            loaderData.url,
            {
              path: loaderData.ogImagePath,
              ...DOCS_OG_SIZE,
              alt: `${loaderData.section}: ${loaderData.title}`,
            },
          ),
          links: [
            { rel: "canonical", href: `https://getbb.app${loaderData.url}` },
            {
              rel: "alternate",
              type: "text/markdown",
              href: loaderData.markdownUrl,
            },
            ...siteHeadLinks(guidesCss, docsCss),
          ],
          scripts: [
            {
              type: "application/ld+json",
              children: breadcrumbJsonLd(loaderData.breadcrumbs),
            },
          ],
        }
      : { meta: [{ title: "bb docs" }] },
  component: DocsRoute,
});

function DocsRoute() {
  return <DocsPage view={Route.useLoaderData()} />;
}
