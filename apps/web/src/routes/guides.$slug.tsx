import { createFileRoute } from "@tanstack/react-router";

import { GuidePage, guideHead, loadGuide } from "../guides/guide-page";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => loadGuide("guides", params.slug),
  head: ({ loaderData }) => guideHead(loaderData?.guide),
  component: GuidesRoute,
});

function GuidesRoute() {
  const { guide } = Route.useLoaderData();
  return <GuidePage guide={guide} />;
}
