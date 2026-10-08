import { createFileRoute, notFound } from "@tanstack/react-router";

import { getLandingPage } from "../landing/landing-pages";
import { LandingTemplate, landingPageHead } from "../landing/landing-template";

function loadLandingPage(slug: string) {
  const page = getLandingPage(slug);
  if (!page) {
    throw notFound();
  }
  return page;
}

export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => ({ slug: loadLandingPage(params.slug).slug }),
  head: ({ loaderData }) => {
    const page = loaderData ? getLandingPage(loaderData.slug) : undefined;
    return page ? landingPageHead(page) : { meta: [{ title: "bb" }] };
  },
  component: LandingRoute,
});

function LandingRoute() {
  const { slug } = Route.useLoaderData();
  return <LandingTemplate page={loadLandingPage(slug)} />;
}
