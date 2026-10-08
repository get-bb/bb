import { notFound } from "@tanstack/react-router";

import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";
import { GuideBody } from "./guide-body";
import { getGuide } from "./guides";
import guidesCss from "./guides.css?url";
import type { Guide, GuideSection } from "./parse-guide";

export function loadGuide(section: GuideSection, slug: string) {
  const guide = getGuide(section, slug);
  if (!guide) {
    throw notFound();
  }
  return { guide };
}

export function guideHead(guide: Guide | undefined) {
  if (!guide) {
    return { meta: [{ title: "bb" }] };
  }
  return {
    meta: pageMeta(`${guide.title} — bb`, guide.description, guide.path),
    links: siteHeadLinks(blogCss, guidesCss),
  };
}

export function GuidePage({ guide }: { guide: Guide }) {
  useInitAnalytics();

  return (
    <div className="wrap">
      <SiteNav />

      <article className="post article guide">
        <div className="post-body">
          <h1>{guide.title}</h1>
          <GuideBody markdown={guide.body} />
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
