import { createFileRoute } from "@tanstack/react-router";

import { GuidePage, guideHead, loadGuide } from "../guides/guide-page";

export const Route = createFileRoute("/compare/$slug")({
  loader: ({ params }) => loadGuide("compare", params.slug),
  head: ({ loaderData }) => guideHead(loaderData?.guide),
  component: CompareRoute,
});

function CompareRoute() {
  const { guide } = Route.useLoaderData();
  return <GuidePage guide={guide} />;
}
