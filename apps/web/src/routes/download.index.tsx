import { createFileRoute } from "@tanstack/react-router";

import { useExperimentBootstrap } from "../experiments/use-experiment";
import { useInitAnalytics } from "../landing/analytics";
import { DOWNLOAD_PAGE_TITLE, DownloadPage } from "../landing/download-page";
import { pageMeta, siteHeadLinks } from "../landing/page-head";
import { DOWNLOAD_PAGE_PATH } from "../landing/site";

const PAGE_DESCRIPTION =
  "Download bb for macOS, Windows, and Linux, install it from a terminal, or get the iPhone and Android apps. Free and open source.";

export const Route = createFileRoute("/download/")({
  head: () => ({
    meta: pageMeta(DOWNLOAD_PAGE_TITLE, PAGE_DESCRIPTION, DOWNLOAD_PAGE_PATH),
    links: siteHeadLinks(),
  }),
  component: DownloadRoute,
});

function DownloadRoute() {
  useInitAnalytics(useExperimentBootstrap());
  return <DownloadPage />;
}
