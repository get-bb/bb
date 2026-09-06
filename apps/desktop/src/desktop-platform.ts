import type { BbDesktopInfo } from "@bb/desktop-contract";

export function resolveBbDesktopPlatform(
  platform: NodeJS.Platform,
): BbDesktopInfo["platform"] {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}
