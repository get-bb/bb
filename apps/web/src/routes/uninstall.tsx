import { createFileRoute } from "@tanstack/react-router";

import { useInitAnalytics } from "../landing/analytics";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { SiteFooter, SiteNav } from "../landing/site-chrome";
import blogCss from "../blog/blog.css?url";

const PAGE_TITLE = "Uninstall bb";
const PAGE_DESCRIPTION =
  "Remove the bb desktop app on macOS, Windows, or Linux, and delete the data bb keeps on your computer.";

export const Route = createFileRoute("/uninstall")({
  head: () => ({
    meta: [
      ...pageMeta(PAGE_TITLE, PAGE_DESCRIPTION, "/uninstall"),
      { name: "robots", content: "noindex" },
    ],
    links: siteHeadLinks(blogCss),
  }),
  component: UninstallRoute,
});

function UninstallRoute() {
  useInitAnalytics();

  return (
    <div className="wrap">
      <SiteNav />

      <article className="post article">
        <div className="post-body">
          <h1>Uninstall bb</h1>

          <p className="lede">
            Remove the app, then delete bb&rsquo;s data folder if you
            don&rsquo;t want to keep your threads and settings.
          </p>

          <h2>1. Quit bb</h2>

          <p>Quit the bb desktop app.</p>

          <h2>2. Remove the app</h2>

          <ul>
            <li>
              Mac: drag <strong>bb</strong> from Applications to the Trash.
            </li>
            <li>
              Windows: open Settings, then Apps, choose <strong>bb</strong>,
              then <strong>Uninstall</strong>.
            </li>
            <li>Linux: delete the bb AppImage.</li>
          </ul>

          <h2>3. Delete your data (optional)</h2>

          <p>
            Delete <code>~/.bb</code> (on Windows,{" "}
            <code>%USERPROFILE%\.bb</code>). It holds your threads, settings,
            plugins, and the worktrees bb created, so push any work you want to
            keep first. Your project folders aren&rsquo;t touched.
          </p>
        </div>
      </article>

      <SiteFooter />
    </div>
  );
}
