import type { Comparison } from "./compare-types";

interface ComparisonModule {
  comparison?: Comparison;
}

export const COMPARISONS: Comparison[] = Object.values(
  import.meta.glob<ComparisonModule>("./pages/*.tsx", { eager: true }),
).flatMap((module) => (module.comparison ? [module.comparison] : []));

export function getComparison(slug: string): Comparison | undefined {
  return COMPARISONS.find((comparison) => comparison.slug === slug);
}
