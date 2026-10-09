import {
  HeadContent,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { carryUtmToDownloadLinks } from "../landing/download-utm";
import { THEME_INIT, watchSystemTheme } from "../lib/theme";

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

function canonicalHref(
  matches: ReadonlyArray<{
    pathname: string;
    status: string;
    globalNotFound?: boolean;
    staticData: { ownsCanonical?: boolean };
  }>,
) {
  const page = matches.at(-1);
  if (
    page === undefined ||
    matches.some(
      (match) =>
        match.status === "notFound" ||
        match.globalNotFound === true ||
        match.staticData.ownsCanonical === true,
    )
  ) {
    return null;
  }
  const path = page.pathname === "/" ? "/" : page.pathname.replace(/\/+$/, "");
  return `https://getbb.app${path}`;
}

const JS_INIT = `document.documentElement.classList.add("js")`;

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => watchSystemTheme(), []);
  useEffect(() => carryUtmToDownloadLinks(), []);
  const canonical = useRouterState({
    select: (state) => canonicalHref(state.matches),
  });
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        <script dangerouslySetInnerHTML={{ __html: JS_INIT }} />
        {}
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content="#ffffff"
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content="#151515"
        />
        {canonical === null ? null : <link rel="canonical" href={canonical} />}
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
