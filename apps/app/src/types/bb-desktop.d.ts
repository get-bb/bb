import type { BbDesktopInfo } from "@bb/server-contract";

declare global {
  interface Window {
    bbDesktop?: BbDesktopInfo;
  }
}

export {};
