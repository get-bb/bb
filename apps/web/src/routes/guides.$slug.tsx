import { createFileRoute } from "@tanstack/react-router";

import { GuidePage, guideHead, loadGuide } from "../guides/guide-page";
import { getGuide } from "../guides/guides";

export const Route = createFileRoute("/guides/$slug")({
  validateSearch: (search: Record<string, unknown>): { from?: string } =>
    typeof search.from === "string" ? { from: search.from } : {},
  loaderDeps: ({ search }) => ({ from: search.from ?? null }),
  loader: ({ params, deps }) => loadGuide(params.slug, deps.from),
  head: ({ loaderData }) =>
    guideHead(
      loaderData ? getGuide(loaderData.slug, loaderData.variant) : undefined,
    ),
  component: GuidesRoute,
});

function GuidesRoute() {
  const { slug, variant } = Route.useLoaderData();
  const guide = getGuide(slug, variant);
  if (!guide) {
    throw new Error(`Guide ${slug} is not registered`);
  }
  return <GuidePage guide={guide} />;
}
