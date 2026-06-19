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

export const SITE_TITLE = "bb — the IDE for loop-driven development";
export const SITE_DESCRIPTION =
  "Orchestrate your coding agents. Drive it yourself, or let your agents and automations drive it for you. Fully open source and local-first, with Claude Code, Codex, Cursor, and Pi.";
