import type { BbDesktopApi } from "@bb/server-contract";

declare global {
  interface Window {
    bbDesktop?: BbDesktopApi;
  }
}

export {};
