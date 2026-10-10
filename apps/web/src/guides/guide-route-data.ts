import { notFound } from "@tanstack/react-router";

import { guideHead } from "./guide-page";
import { loadGuide } from "./guides";

export async function guideRouteData(slug: string) {
  const guide = await loadGuide(slug);
  if (!guide) {
    throw notFound();
  }
  return { slug, head: guideHead(guide) };
}
