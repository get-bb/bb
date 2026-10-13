import { useCallback } from "react";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { getBbDesktopInfo, readWindowFindTopOffset } from "@/lib/bb-desktop";

export function WindowFindHost() {
  const openWindowFind = useCallback((): boolean => {
    const desktop = getBbDesktopInfo();
    if (desktop?.openWindowFind === undefined) {
      return false;
    }
    desktop.openWindowFind({ topOffset: readWindowFindTopOffset() });
    return true;
  }, []);

  useAppCommandHandler("window.find", openWindowFind);

  return null;
}
