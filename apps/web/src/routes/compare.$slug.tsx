import { createFileRoute, notFound } from "@tanstack/react-router";

import { ComparePage, compareHead } from "../compare/compare-page";
import { getComparison } from "../compare/comparisons";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => {
    if (!getComparison(params.slug)) {
      throw notFound();
    }
    return { slug: params.slug };
  },
  head: ({ loaderData }) => {
    const comparison = loaderData ? getComparison(loaderData.slug) : undefined;
    return comparison ? compareHead(comparison) : { meta: [{ title: "bb" }] };
  },
  component: CompareRoute,
});

function CompareRoute() {
  const { slug } = Route.useLoaderData();
  const comparison = getComparison(slug);
  if (!comparison) {
    throw new Error(`Comparison ${slug} is not registered`);
  }
  return <ComparePage comparison={comparison} />;
}
