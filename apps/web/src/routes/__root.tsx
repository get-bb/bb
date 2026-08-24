import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import { THEME_INIT } from "../lib/theme";

// Route-level stylesheets are deliberate: the marketing page (/) imports
// landing.css and the dashboard (/dashboard) imports styles.css (Tailwind +
// theme.css). Both define :root tokens (e.g. --ink), so they must never load
// into the same document — navigation between the two areas is always a
// full-page load (plain <a>, window.location, OAuth redirects), never a
// client-side router transition.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "bb" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32-dark.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16-dark.png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
    ],
  }),
  shellComponent: RootDocument,
});

// Mark JS as available before first paint so the marketing page's app mock can
// start hidden and construct itself in. No-JS keeps it visible.
const JS_INIT = `document.documentElement.classList.add("js")`;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Resolve the bb.theme preference before first paint so a dark result
            doesn't flash light. THEME_INIT (lib/theme.ts) stamps the dark class
            that landing.css and theme.css key their dark tokens off, plus
            data-theme-preference, which the marketing nav's theme control keys
            its button glyph off — so the glyph is right from the first paint
            and hydration has nothing to guess. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: JS_INIT }} />
        {/* One theme-color per scheme, so browser chrome follows the page with
            no JS at all; THEME_INIT narrows the pair with `media` when a stored
            preference overrides the OS. These live here rather than in a route
            head() because the router dedupes metas by name, which would drop
            one of the two. The values mirror landing.css's --bg and theme.css's
            --canvas, which agree in both schemes. */}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#ffffff"
          data-scheme="light"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#151515"
          data-scheme="dark"
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
