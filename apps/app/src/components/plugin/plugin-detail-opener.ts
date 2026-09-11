import { useLayoutEffect, useRef } from "react";

export interface PluginDetailDestination {
  pluginId: string;
  title: string;
}

export type PluginDetailOpener = (
  destination: PluginDetailDestination,
) => boolean;

const focusedOpeners = new Map<symbol, PluginDetailOpener>();

export function openPluginDetailsInWorkspace(
  destination: PluginDetailDestination,
): boolean {
  for (const open of [...focusedOpeners.values()].reverse()) {
    if (open(destination)) return true;
  }
  return false;
}

export function usePublishPluginDetailOpener(
  open: PluginDetailOpener,
  isActive: boolean,
): void {
  const openRef = useRef(open);
  useLayoutEffect(() => {
    openRef.current = open;
  }, [open]);
  useLayoutEffect(() => {
    if (!isActive) return;
    const token = Symbol("plugin-detail-opener");
    focusedOpeners.set(token, (destination) => openRef.current(destination));
    return () => {
      focusedOpeners.delete(token);
    };
  }, [isActive]);
}
