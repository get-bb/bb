export const GITHUB_URL = "https://github.com/get-bb/bb";
export const DISCORD_URL = "https://discord.gg/kvBU6tJhcJ";
export const X_URL = "https://x.com/get_bb_app";
export const DOWNLOAD_FALLBACK_URL =
  "https://github.com/get-bb/bb/releases/tag/desktop-latest";
export const DOWNLOAD_RELEASE_ASSET_BASE_URL =
  "https://github.com/get-bb/bb/releases/download/desktop-latest";

export type DesktopPlatform = "macos" | "linux";

export const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = ["macos", "linux"];

export const DEFAULT_DESKTOP_PLATFORM: DesktopPlatform = "macos";

export type DesktopDownload = {
  label: string;
  buttonLabel: string;
  note: string;
  installerExtension: string;
  versionFeedUrl: string;
  redirectPath: string;
};

export const DESKTOP_DOWNLOADS: Record<DesktopPlatform, DesktopDownload> = {
  macos: {
    label: "macOS",
    buttonLabel: "Download for macOS",
    note: "Apple Silicon",
    installerExtension: ".dmg",
    versionFeedUrl: `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/desktop-version.json`,
    redirectPath: "/download/macos",
  },
  linux: {
    label: "Linux",
    buttonLabel: "Download for Linux",
    note: "x64 AppImage, alpha",
    installerExtension: ".AppImage",
    versionFeedUrl: `${DOWNLOAD_RELEASE_ASSET_BASE_URL}/desktop-version-linux.json`,
    redirectPath: "/download/linux",
  },
};
export const SUBSCRIBE_PATH = "/api/subscribe";
export const CLI_COMMAND = "npx bb-app@latest";

export type CtaPlacement =
  | "nav"
  | "hero"
  | "cli"
  | "loops"
  | "local"
  | "closer"
  | "footer";

export function downloadHref(
  platform: DesktopPlatform,
  placement: CtaPlacement,
): string {
  return `${DESKTOP_DOWNLOADS[platform].redirectPath}?placement=${placement}`;
}

declare const __SITE_ORIGIN__: string;
const SITE_URL = __SITE_ORIGIN__;
export const SITE_TITLE = "bb: the IDE that builds itself";
export const SITE_DESCRIPTION =
  "bb can control, customize, and automate itself, laying the groundwork for your own software factory. Fully open source and local-first, with Claude Code, Codex, Cursor, Pi, OpenCode, Grok, omp, and Hermes.";
export const OG_DESCRIPTION =
  "bb can control, customize, and automate itself, laying the groundwork for your own software factory.";

export function unfurlMeta(title: string, description: string, path: string) {
  return [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: `${SITE_URL}${path}` },
    { property: "og:site_name", content: "bb" },
    { property: "og:image", content: `${SITE_URL}/og.png` },
    { property: "og:image:width", content: "2400" },
    { property: "og:image:height", content: "1260" },
    {
      property: "og:image:alt",
      content:
        "bb logo — The IDE that builds itself. Free, open source, and local-first.",
    },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `${SITE_URL}/og.png` },
  ];
}
