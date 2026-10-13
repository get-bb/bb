import { createFileRoute } from "@tanstack/react-router";

import { ComparePage } from "../compare/compare-page";
import { getComparison } from "../compare/comparisons";

export const Route = createFileRoute("/compare/$slug")({
  loader: async ({ params }) =>
    (await import("../compare/compare-route-data")).compareRouteData(
      params.slug,
    ),
  head: ({ loaderData }) => loaderData?.head ?? { meta: [{ title: "bb" }] },
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
