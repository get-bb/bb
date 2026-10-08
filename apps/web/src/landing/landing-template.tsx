import type { ReactElement } from "react";

import { useInitAnalytics } from "./analytics";
import { ProviderChips, useScrollReveal } from "./landing-visuals";
import { SiteFooter, SiteNav } from "./site-chrome";
import {
  Closer,
  FaqSection,
  Highlight,
  PageHero,
  templatePageHead,
} from "../compare/compare-page";
import { PLUGINS_COPY, pluginsSection } from "../compare/compare-sections";
import type { CompareFaqGroup, CompareHighlight } from "../compare/comparisons";

export type LandingPage = {
  slug: string;
  title: string;
  description: string;
  headline: string;
  sub: string;
  heroVisual: ReactElement;
  sections: CompareHighlight[];
  faq: CompareFaqGroup[];
  closer: string;
};

const CLOSER_BODY =
  "Free and open source, on your own machines. Bring the agents you already use.";

export function textOnly(section: CompareHighlight): CompareHighlight {
  return { ...section, visual: null, wide: true };
}

export function landingPagePath(page: LandingPage): string {
  return `/${page.slug}`;
}

export function landingPageHead(page: LandingPage) {
  return templatePageHead({
    path: landingPagePath(page),
    title: page.title,
    description: page.description,
    faq: page.faq,
  });
}

export function LandingTemplate({ page }: { page: LandingPage }) {
  useInitAnalytics();
  useScrollReveal();

  return (
    <div className="wrap cmp-page">
      <SiteNav />

      <PageHero
        top={
          <div className="providers cmp-hero-providers">
            <span className="label">Works with</span>
            <ProviderChips />
          </div>
        }
        headline={page.headline}
        sub={page.sub}
        visual={page.heroVisual}
      />

      {[...page.sections, pluginsSection(PLUGINS_COPY)].map((highlight) => (
        <Highlight key={highlight.title} highlight={highlight} />
      ))}

      <FaqSection title="Common questions" faq={page.faq} />

      <Closer closer={{ title: page.closer, body: CLOSER_BODY }} />

      <SiteFooter current={landingPagePath(page)} />
    </div>
  );
}
