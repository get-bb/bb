import { contextBridge } from "electron";
import type { BbDesktopInfo } from "@bb/server-contract";

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

const bbDesktopInfo: BbDesktopInfo = {
  platform: "macos",
  version: getDesktopVersion(process.env.BB_DESKTOP_VERSION),
};

contextBridge.exposeInMainWorld("bbDesktop", bbDesktopInfo);
