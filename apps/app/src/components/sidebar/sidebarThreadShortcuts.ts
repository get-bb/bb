import { createContext, useContext } from "react";

const SIDEBAR_THREAD_SHORTCUT_TARGET_SELECTOR =
  "[data-sidebar-thread-shortcut-target]";

export const MAX_SIDEBAR_THREAD_SHORTCUTS = 9;

export interface SidebarThreadShortcutTarget {
  element: HTMLAnchorElement;
  key: string;
  threadId: string;
}

interface SidebarThreadShortcutKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
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

export function getSidebarThreadShortcutIndex(
  event: SidebarThreadShortcutKeyboardEvent,
): number | null {
  if (
    event.defaultPrevented ||
    !event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    !/^[1-9]$/.test(event.key)
  ) {
    return null;
  }

  return Number(event.key) - 1;
}

export function useSidebarThreadShortcutKey(
  threadId: string,
): string | undefined {
  return useContext(SidebarThreadShortcutKeysContext).get(threadId);
}
