import { useLayoutEffect, useRef, useState } from "react";
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk";

export interface OpenThreadActionMenu {
  thread: PluginThreadActionTarget;
  requestRename: ((threadId: string) => void) | undefined;
  close: () => void;
}

interface OpenThreadActionMenuSlot {
  owner: symbol;
  read: () => OpenThreadActionMenu;
}

let openMenu: OpenThreadActionMenuSlot | null = null;

export function getOpenThreadActionMenuTarget(): OpenThreadActionMenu | null {
  return openMenu?.read() ?? null;
}

export function usePublishOpenThreadActionMenuTarget(
  menu: OpenThreadActionMenu,
  open: boolean,
): void {
  const [owner] = useState(() => Symbol("thread-actions-menu"));
  const latest = useRef(menu);
  useLayoutEffect(() => {
    latest.current = menu;
  });
  useLayoutEffect(() => {
    if (!open) return;
    openMenu = { owner, read: () => latest.current };
    return () => {
      if (openMenu?.owner === owner) openMenu = null;
    };
  }, [open, owner]);
}
