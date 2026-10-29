import { pickUtmParams } from "./download-utm";
import { CLICK_ID_PARAM_NAMES } from "./site";

export type DownloadIntent = {
  source_path: string;
  page_family: "homepage" | "marketplace" | "comparison" | "other";
  page_subtype:
    | "homepage"
    | "root"
    | "author"
    | "detail"
    | "comparison"
    | "other";
  placement: string;
  download_target: "macos" | "windows" | "linux";
  measurement_version: 1;
  intent_at: string;
  download_campaign: Record<string, string>;
};

export function listenForDownloadIntent(
  capture: (properties: DownloadIntent) => void,
): () => void {
  const activate = (event: MouseEvent) => {
    if (
      (event.type === "click" && event.button !== 0) ||
      (event.type === "auxclick" && event.button !== 1)
    )
      return;
    const link =
      event.target instanceof Element ? event.target.closest("a") : null;
    if (
      !(link instanceof HTMLAnchorElement) ||
      link.origin !== window.location.origin
    )
      return;
    const target = /^\/download\/(macos|windows|linux)$/.exec(
      link.pathname,
    )?.[1];
    if (target !== "macos" && target !== "windows" && target !== "linux")
      return;
    const path = window.location.pathname;
    const family =
      path === "/"
        ? "homepage"
        : path === "/marketplace" || path.startsWith("/marketplace/")
          ? "marketplace"
          : path.startsWith("/compare/")
            ? "comparison"
            : "other";
    const subtype =
      family === "marketplace"
        ? path === "/marketplace"
          ? "root"
          : path.startsWith("/marketplace/author/")
            ? "author"
            : "detail"
        : family;
    const campaign = pickUtmParams(link.search);
    if (
      "globalPrivacyControl" in navigator &&
      navigator.globalPrivacyControl === true
    ) {
      for (const name of CLICK_ID_PARAM_NAMES) campaign.delete(name);
    }
    capture({
      source_path: path,
      page_family: family,
      page_subtype: subtype,
      placement: new URL(link.href).searchParams.get("placement") ?? "inline",
      download_target: target,
      measurement_version: 1,
      intent_at: new Date().toISOString(),
      download_campaign: Object.fromEntries(campaign),
    });
  };
  document.addEventListener("click", activate, true);
  document.addEventListener("auxclick", activate, true);
  return () => {
    document.removeEventListener("click", activate, true);
    document.removeEventListener("auxclick", activate, true);
  };
}
