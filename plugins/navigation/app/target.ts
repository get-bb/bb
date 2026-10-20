import type { MouseEvent } from "react";
import type { ExperimentalSidebarNavigationTarget } from "@get-bb/plugin-sdk/app";

export function isNewViewClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function clickTarget(
  event: MouseEvent,
): ExperimentalSidebarNavigationTarget {
  return isNewViewClick(event) ? "split" : "current";
}
