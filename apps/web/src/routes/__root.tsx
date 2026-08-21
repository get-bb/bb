import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

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
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
});

// Set the dark class before first paint so a stored/system dark preference
// doesn't flash light anywhere (mirrors the bb app's pre-paint script). The
// dashboard's theme.css and the marketing pages' landing.css both key their
// dark tokens off this class; the marketing nav's theme toggle writes the
// same bb.theme key (see landing/site-chrome.tsx).
// The routes ship a light theme-color meta; when the resolved theme is dark,
// retint it to landing.css's dark --bg (oklch(0.195 0 0) ≈ #151515) once the
// head has parsed. Two media-scoped metas would be the declarative fix, but
// the router dedupes meta tags by name, so only one can survive. The nav's
// theme toggle re-syncs the meta on every explicit flip.
const THEME_INIT = `try{var t=localStorage.getItem("bb.theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark");document.addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.content="#151515"})}}catch(e){}`;

// Mark JS as available before first paint so the marketing page's app mock can
// start hidden and construct itself in. No-JS keeps it visible.
const JS_INIT = `document.documentElement.classList.add("js")`;

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: JS_INIT }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
