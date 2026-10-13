import { notFound } from "@tanstack/react-router";

import { getLandingPage } from "./landing-pages";
import { landingPageHead } from "./landing-template";

export function landingRouteData(slug: string) {
  const page = getLandingPage(slug);
  if (!page) {
    throw notFound();
  }
  return { slug, head: landingPageHead(page) };
}
