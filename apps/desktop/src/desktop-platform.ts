import type { BbDesktopInfo } from "@bb/desktop-contract";

export function resolveBbDesktopPlatform(
  platform: NodeJS.Platform,
): BbDesktopInfo["platform"] {
  return platform === "darwin" ? "macos" : "linux";
}
