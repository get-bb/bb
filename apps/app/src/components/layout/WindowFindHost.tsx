import { useCallback } from "react";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import { getBbDesktopInfo, readWindowFindTopOffset } from "@/lib/bb-desktop";
import { WINDOW_FIND_OPEN_EVENT } from "@/lib/window-find";

export function WindowFindHost() {
  const openWindowFind = useCallback((): boolean => {
    const desktop = getBbDesktopInfo();
    if (desktop?.openWindowFind === undefined) {
      return false;
    }
    window.dispatchEvent(new Event(WINDOW_FIND_OPEN_EVENT));
    desktop.openWindowFind({ topOffset: readWindowFindTopOffset() });
    return true;
  }, []);

  useAppCommandHandler("window.find", openWindowFind);

  return null;
}
