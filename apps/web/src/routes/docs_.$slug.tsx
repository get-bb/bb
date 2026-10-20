import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { DocPage } from "../docs/doc-page";
import { DOC_REDIRECTS, getDoc } from "../docs/docs";
import docsCss from "../docs/docs.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";

export const Route = createFileRoute("/docs_/$slug")({
  loader: async ({ params }) => {
    const destination = DOC_REDIRECTS[`/docs/${params.slug}`];
    if (destination) {
      throw redirect({ href: destination, statusCode: 301 });
    }
    const doc = await getDoc(params.slug);
    if (!doc) throw notFound();
    return { doc };
  },
  head: ({ loaderData }) => {
    const meta = loaderData?.doc.meta;
    return {
      meta: meta
        ? pageMeta(`${meta.title} — bb Docs`, meta.description, meta.path)
        : [{ title: "Docs — bb" }],
      links: siteHeadLinks(docsCss),
    };
  },
  component: DocRoute,
});

function DocRoute() {
  const { doc } = Route.useLoaderData();
  useInitAnalytics();
  return <DocPage meta={doc.meta} body={doc.body} />;
}
