import { createFileRoute } from "@tanstack/react-router";
import { Suspense, use } from "react";

import { GuidePage } from "../guides/guide-page";
import { loadGuide, loadedGuide } from "../guides/guides";

export const Route = createFileRoute("/guides/$slug")({
  loader: async ({ params }) =>
    (await import("../guides/guide-route-data")).guideRouteData(params.slug),
  head: ({ loaderData }) => loaderData?.head ?? { meta: [{ title: "bb" }] },
  component: GuidesRoute,
});

function GuidesRoute() {
  const { slug } = Route.useLoaderData();
  return (
    <Suspense fallback={null}>
      <LoadedGuide slug={slug} />
    </Suspense>
  );
}

function LoadedGuide({ slug }: { slug: string }) {
  const guide = loadedGuide(slug) ?? use(loadGuide(slug));
  if (!guide) {
    throw new Error(`Guide ${slug} is not registered`);
  }
  return <GuidePage guide={guide} />;
}
