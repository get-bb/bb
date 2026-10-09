import { createFileRoute } from "@tanstack/react-router";

import { GuidePage, guideHead, loadGuide } from "../guides/guide-page";
import { getGuide } from "../guides/guides";

export const Route = createFileRoute("/guides/$slug")({
  loader: ({ params }) => loadGuide(params.slug),
  head: ({ loaderData }) =>
    guideHead(loaderData ? getGuide(loaderData.slug) : undefined),
  component: GuidesRoute,
});

function GuidesRoute() {
  const { slug } = Route.useLoaderData();
  const guide = getGuide(slug);
  if (!guide) {
    throw new Error(`Guide ${slug} is not registered`);
  }
  return <GuidePage guide={guide} />;
}
