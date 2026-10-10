import { createFileRoute } from "@tanstack/react-router";

import { GuidePage } from "../guides/guide-page";
import { getGuide } from "../guides/guides";

export const Route = createFileRoute("/guides/$slug")({
  staticData: { ownsCanonical: true },
  loader: async ({ params }) =>
    (await import("../guides/guide-page")).guideRouteData(params.slug),
  head: ({ loaderData }) => loaderData?.head ?? { meta: [{ title: "bb" }] },
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
