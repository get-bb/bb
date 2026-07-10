import { createContext, useContext } from "react";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";

const SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR =
  "[data-sidebar-thread-shortcut-target]";

export const MAX_SIDEBAR_THREAD_SHORTCUTS = 9;

export interface SidebarThreadShortcutTarget {
  element: HTMLAnchorElement;
  key: string;
  threadId: string;
}

export type SidebarThreadShortcutPresentation = AppShortcutPresentation;

export const EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS: ReadonlyMap<
  string,
  SidebarThreadShortcutPresentation
> = new Map();

export const SidebarThreadShortcutKeysContext = createContext<
  ReadonlyMap<string, SidebarThreadShortcutPresentation>
>(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);

function collectSidebarThreadTargets(
  root: HTMLElement | null,
  limit: number,
): SidebarThreadShortcutTarget[] {
  if (!root) {
    return [];
  }

  const elements = root.querySelectorAll<HTMLAnchorElement>(
    SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR,
  );
  const targets: SidebarThreadShortcutTarget[] = [];

  for (const element of elements) {
    const threadId = element.dataset.sidebarThreadId;
    if (!threadId) {
      continue;
    }

    targets.push({
      element,
      key: String(targets.length + 1),
      threadId,
    });
    if (targets.length === limit) {
      break;
    }
  }

  return targets;
}

export function getSidebarThreadShortcutTargets(
  root: HTMLElement | null,
): SidebarThreadShortcutTarget[] {
  return collectSidebarThreadTargets(root, MAX_SIDEBAR_THREAD_SHORTCUTS);
}

export function getSidebarThreadNavigationTargets(
  root: HTMLElement | null,
): SidebarThreadShortcutTarget[] {
  return collectSidebarThreadTargets(root, Number.POSITIVE_INFINITY);
}

export function useSidebarThreadShortcut(
  threadId: string,
): SidebarThreadShortcutPresentation | undefined {
  return useContext(SidebarThreadShortcutKeysContext).get(threadId);
}
