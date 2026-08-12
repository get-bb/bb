export const GITHUB_URL = "https://github.com/get-bb/bb";
export const DISCORD_URL = "https://discord.gg/kvBU6tJhcJ";
export const DOWNLOAD_MACOS_FALLBACK_URL =
  "https://github.com/get-bb/bb/releases/tag/desktop-latest";
export const DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL =
  "https://github.com/get-bb/bb/releases/download/desktop-latest";
export const DOWNLOAD_MACOS_VERSION_FEED_URL = `${DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL}/desktop-version.json`;
export const DOWNLOAD_MACOS_REDIRECT_PATH = "/download/macos";
/** First-party endpoint that adds an email to the bb marketing audience.
 *  Handled by the Worker (see worker.ts), not a prerendered asset. */
export const SUBSCRIBE_PATH = "/api/subscribe";
export const CLI_COMMAND = "npx bb-app@latest";

/** Launch-day switch. While this is true the hero's announcement pill asks for
 *  a Product Hunt vote instead of linking to the latest release. Flip it to
 *  false after the launch and the changelog callout comes back — nothing else
 *  needs to change. */
export const PRODUCT_HUNT_LAUNCH_ACTIVE = false;

/** The Product Hunt launch page. The UTM parameters are the ones Product Hunt
 *  issued with the embed, kept so they can attribute the traffic back. */
export const PRODUCT_HUNT_URL =
  "https://www.producthunt.com/products/bb?utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-bb";

/** Where on the page a CTA lives, for click-through comparison. */
export type CtaPlacement =
  | "nav"
  | "hero"
  | "cli"
  | "loops"
  | "local"
  | "closer"
  | "footer";

export function downloadMacosHref(placement: CtaPlacement): string {
  return `${DOWNLOAD_MACOS_REDIRECT_PATH}?placement=${placement}`;
}

/** Injected by vite.config.ts from the target deployment's APP_URL — see
 *  src/server/site-origin.ts for why the unfurl tags can't hardcode one. */
declare const __SITE_ORIGIN__: string;
export const SITE_URL = __SITE_ORIGIN__;
export const SITE_TITLE = "bb: the IDE that builds itself";
export const SITE_DESCRIPTION =
  "bb can control, customize, and automate itself, laying the groundwork for your own software factory. Fully open source and local-first, with Claude Code, Codex, Cursor, Pi, OpenCode, Grok, omp, and Hermes.";
/** Unfurl copy: the hero sub verbatim, without SITE_DESCRIPTION's provider
 *  list because link previews truncate around 200 characters. */
export const OG_DESCRIPTION =
  "bb can control, customize, and automate itself, laying the groundwork for your own software factory.";

/** Open Graph + Twitter tags that make a shared link unfurl with the bb card.
 *  The image URL must be absolute: scrapers fetch tags with no base URL. */
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
