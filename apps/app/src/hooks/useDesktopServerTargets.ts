import { useEffect, useMemo, useState } from "react";
import type { BbDesktopServerTarget } from "@bb/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export interface DesktopServerTargetsControl {
  servers: readonly BbDesktopServerTarget[];
  select(id: string): void;
}

export function useDesktopServerTargets(): DesktopServerTargetsControl | null {
  const [desktopApi] = useState(getBbDesktopInfo);
  const [servers, setServers] = useState<BbDesktopServerTarget[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = desktopApi?.onServerTargetsChange?.(setServers);
    desktopApi?.getServerTargets?.().then(
      (nextServers) => {
        if (!cancelled) {
          setServers(nextServers);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [desktopApi]);

  return useMemo(() => {
    const selectServerTarget = desktopApi?.selectServerTarget;
    if (servers === null || selectServerTarget === undefined) {
      return null;
    }
    return {
      servers,
      select(id: string) {
        selectServerTarget.call(desktopApi, id);
      },
    };
  }, [desktopApi, servers]);
}
