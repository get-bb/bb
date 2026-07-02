export const GITHUB_URL = "https://github.com/ymichael/bb";
export const DOWNLOAD_MACOS_FALLBACK_URL =
  "https://github.com/ymichael/bb/releases/tag/desktop-latest";
export const DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL =
  "https://github.com/ymichael/bb/releases/download/desktop-latest";
export const DOWNLOAD_MACOS_VERSION_FEED_URL = `${DOWNLOAD_MACOS_RELEASE_ASSET_BASE_URL}/desktop-version.json`;
export const DOWNLOAD_MACOS_REDIRECT_PATH = "/download/macos";
/** First-party endpoint that adds an email to the bb marketing audience.
 *  Handled by the Worker (see worker.ts), not a prerendered asset. */
export const SUBSCRIBE_PATH = "/api/subscribe";
export const CLI_COMMAND = "npx bb-app@latest";

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

export const SITE_TITLE = "bb: the IDE for loop-driven development";
export const SITE_DESCRIPTION =
  "bb can control, customize, and automate itself, laying the groundwork for your own software factory. Fully open source and local-first, with Claude Code, Codex, Cursor, Pi, and OpenCode.";
