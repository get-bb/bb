import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import blogCss from "../blog/blog.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { LazyPluginGuide } from "../plugin-guide/lazy-plugin-guide";
import pluginGuideCss from "../plugin-guide/plugin-guide.css?url";

const PAGE_TITLE = "Plugin Guide — bb";
const PAGE_DESCRIPTION =
  "Every place a bb plugin can extend the app, mapped onto the product.";

interface PluginGuideSearch {
  slide?: string;
}

export const Route = createFileRoute("/plugin-guide")({
  validateSearch: (search: Record<string, unknown>): PluginGuideSearch =>
    typeof search.slide === "string" && search.slide !== ""
      ? { slide: search.slide }
      : {},
  head: () => ({
    meta: pageMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/plugin-guide"),
    links: [
      { rel: "stylesheet", href: pluginGuideCss },
      ...siteHeadLinks(blogCss),
      { rel: "canonical", href: "https://getbb.app/plugin-guide" },
    ],
  }),
  component: PluginGuideRoute,
});

function PluginGuideRoute() {
  useInitAnalytics();
  const { slide } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onSlideChange = useCallback(
    (slideId: string) => {
      void navigate({
        search: { slide: slideId },
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );

  return (
    <>
      <div className="wrap">
        <SiteNav current="plugin-guide" />
        <header className="page-head guide-head">
          <h1>Plugin Guide</h1>
          <p className="sub">Every place a plugin can extend bb.</p>
        </header>
      </div>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-2 sm:px-7 sm:pt-6">
        <LazyPluginGuide initialSlideId={slide} onSlideChange={onSlideChange} />
      </main>
      <div className="wrap">
        <SiteFooter current="/plugin-guide" />
      </div>
    </>
  );
}
