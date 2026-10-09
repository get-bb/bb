import type { Guide } from "./guide-types";

interface GuideModule {
  guide?: Guide;
  guideVariant?: (variant: string | null) => Guide;
}

const MODULES = Object.values(
  import.meta.glob<GuideModule>("./pages/*.tsx", { eager: true }),
);

export const GUIDES: Guide[] = MODULES.flatMap((module) =>
  module.guide ? [module.guide] : [],
);

export function getGuide(
  slug: string,
  variant: string | null,
): Guide | undefined {
  const module = MODULES.find((item) => item.guide?.slug === slug);
  if (!module?.guide) {
    return undefined;
  }
  return module.guideVariant ? module.guideVariant(variant) : module.guide;
}
