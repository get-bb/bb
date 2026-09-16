import { createContext, useContext } from "react";
import type { AppShortcutPresentation } from "@/lib/app-keybindings";

const SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR =
  "[data-sidebar-thread-shortcut-target]";

const MAX_SIDEBAR_THREAD_SHORTCUTS = 9;

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

export function getSidebarThreadShortcutTargets(
  root: HTMLElement | null,
): SidebarThreadShortcutTarget[] {
  if (!root) {
    return [];
  }

  const targets: SidebarThreadShortcutTarget[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(
    SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR,
  )) {
    if (!(element instanceof HTMLAnchorElement)) {
      continue;
    }
    const threadId = element.dataset.sidebarThreadId;
    if (!threadId) {
      continue;
    }
    targets.push({ element, key: String(targets.length + 1), threadId });
    if (targets.length === MAX_SIDEBAR_THREAD_SHORTCUTS) {
      break;
    }
  }

  return targets;
}

export function useSidebarThreadShortcut(
  threadId: string,
): SidebarThreadShortcutPresentation | undefined {
  return useContext(SidebarThreadShortcutKeysContext).get(threadId);
}
