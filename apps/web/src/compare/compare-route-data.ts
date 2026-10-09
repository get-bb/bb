import { notFound } from "@tanstack/react-router";

import { compareHead } from "./compare-page";
import { getComparison } from "./comparisons";

export function compareRouteData(slug: string) {
  const comparison = getComparison(slug);
  if (!comparison) {
    throw notFound();
  }
  return { slug, head: compareHead(comparison) };
}
