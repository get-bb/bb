import { useEffect, useState } from "react";
import type { BbDesktopServerListEntry } from "@bb/desktop-contract";
import { getDesktopServersApi } from "@/lib/bb-desktop";

/**
 * Live desktop server registry list (empty on web builds / older shells).
 * Subscribes to shell pushes; multiple consumers each hold a cheap
 * subscription — the preload bridge fans out a single IPC listener.
 */
export function useDesktopServerList(): BbDesktopServerListEntry[] {
  const [serversApi] = useState(getDesktopServersApi);
  const [servers, setServers] = useState<BbDesktopServerListEntry[]>([]);

  useEffect(() => {
    if (serversApi === null) {
      return;
    }
    let cancelled = false;
    void serversApi.list().then((list) => {
      if (!cancelled) setServers(list);
    });
    const unsubscribe = serversApi.onChange(setServers);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [serversApi]);

  return servers;
}

/** The sidebar server rail renders only with two or more servers. */
export function useHasServerRail(): boolean {
  return useDesktopServerList().length >= 2;
}
