import { createContext, useContext } from "react";

const SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR =
  "[data-sidebar-thread-shortcut-target]";

export const MAX_SIDEBAR_THREAD_SHORTCUTS = 9;

export interface SidebarThreadShortcutTarget {
  element: HTMLAnchorElement;
  key: string;
  threadId: string;
}

export const EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS: ReadonlyMap<string, string> =
  new Map();

export const SidebarThreadShortcutKeysContext = createContext<
  ReadonlyMap<string, string>
>(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);

export function getSidebarThreadShortcutTargets(
  root: HTMLElement | null,
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
    if (targets.length === MAX_SIDEBAR_THREAD_SHORTCUTS) {
      break;
    }
  }

  return targets;
}

export function useSidebarThreadShortcutKey(
  threadId: string,
): string | undefined {
  return useContext(SidebarThreadShortcutKeysContext).get(threadId);
}
