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
    links: siteHeadLinks(blogCss, pluginGuideCss),
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
        <SiteNav />
        <header className="page-head">
          <h1>Plugin Guide</h1>
          <p className="sub">
            Every place a plugin can extend bb, mapped onto the product. Pick a
            numbered region to see what a plugin can add there and which
            built-in plugins already use it.
          </p>
        </header>
      </div>
      <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-7">
        <LazyPluginGuide initialSlideId={slide} onSlideChange={onSlideChange} />
      </main>
      <div className="wrap">
        <SiteFooter />
      </div>
    </>
  );
}
