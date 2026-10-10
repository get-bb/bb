import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import blogCss from "../blog/blog.css?url";
import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import { LazyPluginGuide } from "../plugin-guide/lazy-plugin-guide";
import pluginGuideCss from "../plugin-guide/plugin-guide.css?url";
import { PluginSurfaceIndex } from "../plugin-guide/plugin-surface-index";
import surfaceIndexCss from "../plugin-guide/surface-index.css?url";

const PAGE_TITLE = "Plugin Guide — bb";
const PAGE_DESCRIPTION =
  "Every place a bb plugin can extend the app: the sidebar, threads, prompt box, command palette, home page, settings, and backend APIs, with SDK symbols for each.";

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
      ...siteHeadLinks(blogCss, surfaceIndexCss),
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
  const [opened, setOpened] = useState({ count: 0, slideId: slide });
  const onOpenSlide = useCallback(
    (slideId: string) => {
      setOpened((current) => ({ count: current.count + 1, slideId }));
      onSlideChange(slideId);
      document
        .getElementById("plugin-guide")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [onSlideChange],
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
        <div id="plugin-guide" className="scroll-mt-6">
          <LazyPluginGuide
            key={opened.count}
            initialSlideId={opened.slideId}
            onSlideChange={onSlideChange}
          />
        </div>
        <PluginSurfaceIndex onOpenSlide={onOpenSlide} />
      </main>
      <div className="wrap">
        <SiteFooter current="/plugin-guide" />
      </div>
    </>
  );
}
