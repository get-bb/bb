import interWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { ComponentProps } from "react";

import landingCss from "./landing.css?url";
import { unfurlMeta } from "./site";

export function siteHeadLinks(
  ...stylesheets: string[]
): Array<ComponentProps<"link">> {
  return [
    {
      rel: "preload",
      href: interWoff2,
      as: "font",
      type: "font/woff2",
      crossOrigin: "anonymous",
    },
    { rel: "stylesheet", href: landingCss },
    ...stylesheets.map((href) => ({ rel: "stylesheet", href })),
  ];
}

export function pageMeta(title: string, description: string, path: string) {
  return [
    { title },
    { name: "description", content: description },
    ...unfurlMeta(title, description, path),
  ];
}
