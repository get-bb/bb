import type { Guide } from "./guide-types";

interface GuideModule {
  guide?: Guide;
}

export const GUIDES: Guide[] = Object.values(
  import.meta.glob<GuideModule>("./pages/*.tsx", { eager: true }),
).flatMap((module) => (module.guide ? [module.guide] : []));

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
