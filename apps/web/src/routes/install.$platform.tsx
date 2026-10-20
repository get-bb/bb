import { createFileRoute, notFound } from "@tanstack/react-router";

import { InstallPage } from "../landing/install-page";
import installCss from "../landing/install.css?url";
import { siteHeadLinks } from "../landing/page-head";
import type { DesktopPlatform } from "../landing/site";

export const Route = createFileRoute("/install/$platform")({
  loader: ({ params }): { platform: DesktopPlatform } => {
    const { platform } = params;
    if (
      platform !== "macos" &&
      platform !== "windows" &&
      platform !== "linux"
    ) {
      throw notFound();
    }
    return { platform };
  },
  head: () => ({
    meta: [
      { title: "Your download is starting · bb" },
      { name: "robots", content: "noindex" },
    ],
    links: siteHeadLinks(installCss),
  }),
  component: InstallRoute,
});

function InstallRoute() {
  const { platform } = Route.useLoaderData();
  return <InstallPage platform={platform} />;
}
