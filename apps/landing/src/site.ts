export const GITHUB_URL = "https://github.com/ymichael/bb";
export const DOWNLOAD_MACOS_URL =
  "https://github.com/ymichael/bb/releases/tag/desktop-latest";
export const DOWNLOAD_MACOS_REDIRECT_PATH = "/download/macos";
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

export const SITE_TITLE = "bb — the IDE anything can drive";
export const SITE_DESCRIPTION =
  "You drive it by hand; your agents, your own scripts, and automations drive it through a CLI. Every thread lands in one local-first place, waiting for you. Claude Code, Codex, Cursor, and Pi — free and open source.";
