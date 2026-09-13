import type { BbDesktopInfo } from "@bb/desktop-contract";

export function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

export function resolveBbDesktopPlatform(
  platform: NodeJS.Platform,
): BbDesktopInfo["platform"] {
  return platform === "darwin" ? "macos" : "linux";
}
