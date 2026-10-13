import { createFileRoute } from "@tanstack/react-router";

import { getLandingPage } from "../landing/landing-pages";
import { LandingTemplate } from "../landing/landing-template";

export const Route = createFileRoute("/$slug")({
  loader: async ({ params }) =>
    (await import("../landing/landing-route-data")).landingRouteData(
      params.slug,
    ),
  head: ({ loaderData }) => loaderData?.head ?? { meta: [{ title: "bb" }] },
  component: LandingRoute,
});

function LandingRoute() {
  const { slug } = Route.useLoaderData();
  const page = getLandingPage(slug);
  if (!page) {
    throw new Error(`Landing page ${slug} is not registered`);
  }
  return <LandingTemplate page={page} />;
}
