import type { BbDesktopInfo } from "@bb/desktop-contract";

export function resolveBbDesktopPlatform(
  platform: NodeJS.Platform,
): BbDesktopInfo["platform"] {
  if (platform === "win32") {
    return "windows";
  }
  return platform === "darwin" ? "macos" : "linux";
}
