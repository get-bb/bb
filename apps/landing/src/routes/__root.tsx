import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import "@fontsource-variable/inter";
import "../styles.css";

import { initAnalytics } from "../analytics";
import { SITE_DESCRIPTION, SITE_TITLE } from "../site";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#ffffff" },
    ],
    links: [
      {
        rel: "preload",
        href: interWoff2,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
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
  component: RootComponent,
});

function RootComponent() {
  useEffect(() => {
    initAnalytics();
  }, []);
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
