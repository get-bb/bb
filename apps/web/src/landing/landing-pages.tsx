import type { LandingPage } from "./landing-template";

interface LandingModule {
  page?: LandingPage;
}

export const LANDING_PAGES: LandingPage[] = Object.values(
  import.meta.glob<LandingModule>("./pages/*.tsx", { eager: true }),
).flatMap((module) => (module.page ? [module.page] : []));

export function getLandingPage(slug: string): LandingPage | undefined {
  return LANDING_PAGES.find((page) => page.slug === slug);
}
