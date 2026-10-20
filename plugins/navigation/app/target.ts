import type { MouseEvent } from "react";
import type { ExperimentalSidebarNavigationTarget } from "@get-bb/plugin-sdk/app";

export function isNewViewClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function clickTarget(
  event: MouseEvent,
  isSplitAvailable: boolean,
): ExperimentalSidebarNavigationTarget {
  if (!isNewViewClick(event)) return "current";
  return isSplitAvailable ? "split" : "tab";
}
