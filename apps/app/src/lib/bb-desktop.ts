import type { BbDesktopInfo } from "@bb/server-contract";

export function getBbDesktopInfo(): BbDesktopInfo | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.bbDesktop ?? null;
}
