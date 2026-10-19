import { TouchSensor } from "@dnd-kit/core";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  getMediaQuerySnapshot,
  subscribeMediaQuery,
} from "@bb/shared-ui/hooks/use-media-query";
import {
  isCompactSidebarDrawerShowing,
  subscribeCompactSidebarDrawerShowing,
} from "@/components/ui/sidebar-mobile-drawer-visibility.js";

function shouldInstallSidebarTouchMoveListener(): boolean {
  return (
    !getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY) ||
    isCompactSidebarDrawerShowing()
  );
}

export class SidebarTouchSensor extends TouchSensor {
  static override setup(): () => void {
    if (typeof window === "undefined") {
      return () => {};
    }
    const noop = () => {};
    let installed = false;
    const sync = () => {
      const wanted = shouldInstallSidebarTouchMoveListener();
      if (wanted && !installed) {
        window.addEventListener("touchmove", noop, {
          capture: false,
          passive: false,
        });
        installed = true;
      } else if (!wanted && installed) {
        window.removeEventListener("touchmove", noop);
        installed = false;
      }
    };
    sync();
    const unsubscribeDrawer = subscribeCompactSidebarDrawerShowing(sync);
    const unsubscribeViewport = subscribeMediaQuery(
      COMPACT_VIEWPORT_QUERY,
      sync,
    );
    return () => {
      unsubscribeDrawer();
      unsubscribeViewport();
      if (installed) {
        window.removeEventListener("touchmove", noop);
        installed = false;
      }
    };
  }
}
