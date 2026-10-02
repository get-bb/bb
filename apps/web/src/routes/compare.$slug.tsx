import { createFileRoute } from "@tanstack/react-router";

import { ComparePage, compareHead } from "../compare/compare-page";
import { getComparison } from "../compare/comparisons";
import { GuidePage, guideHead, loadGuide } from "../guides/guide-page";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) =>
    getComparison(params.slug)
      ? { kind: "comparison" as const, slug: params.slug }
      : { kind: "guide" as const, ...loadGuide("compare", params.slug) },
  head: ({ loaderData }) => {
    const comparison =
      loaderData?.kind === "comparison"
        ? getComparison(loaderData.slug)
        : undefined;
    if (comparison) {
      return compareHead(comparison);
    }
    return guideHead(
      loaderData?.kind === "guide" ? loaderData.guide : undefined,
    );
  },
  component: CompareRoute,
});

function CompareRoute() {
  const data = Route.useLoaderData();
  if (data.kind === "guide") {
    return <GuidePage guide={data.guide} />;
  }
  const comparison = getComparison(data.slug);
  if (!comparison) {
    throw new Error(`Comparison ${data.slug} is not registered`);
  }
  return <ComparePage comparison={comparison} />;
}
