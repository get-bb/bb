import type { BbDesktopApi } from "@bb/desktop-contract";

declare global {
  interface Window {
    bbDesktop?: BbDesktopApi;
  }
}

export {};
