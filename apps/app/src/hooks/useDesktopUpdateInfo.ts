import { useEffect, useState } from "react";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export interface DesktopUpdateInfo {
  desktopApi: BbDesktopApi | null;
  desktopInfo: BbDesktopInfo | null;
}

/**
 * Live desktop shell update state. Both fields stay null on the web build.
 * The desktop main process owns the hourly update check; this only mirrors
 * its info object into React state.
 */
export function useDesktopUpdateInfo(): DesktopUpdateInfo {
  const [desktopApi, setDesktopApi] = useState<BbDesktopApi | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<BbDesktopInfo | null>(null);

  useEffect(() => {
    const api = getBbDesktopInfo();
    if (api === null) {
      return;
    }
    setDesktopApi(api);

    let mounted = true;
    void api
      .getInfo()
      .then((info) => {
        if (mounted) {
          setDesktopInfo(info);
        }
      })
      .catch(() => undefined);
    const unsubscribe = api.onChange((info) => {
      setDesktopInfo(info);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { desktopApi, desktopInfo };
}
