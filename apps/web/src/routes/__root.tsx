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
// doesn't flash light on the dashboard (mirrors the bb app's pre-paint
// script). The marketing page is light-only and has no .dark rules, so the
// class is inert there.
const THEME_INIT = `try{var t=localStorage.getItem("bb.theme");if(t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))document.documentElement.classList.add("dark")}catch(e){}`;

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
