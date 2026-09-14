import { useCallback, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useStore } from "jotai";
import { setPluginEnabled } from "@/hooks/queries/plugin-settings-queries";
import { maximizedPaneIdAtom, splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  findPane,
  listPanes,
  removePane,
  replacePaneContent,
} from "@/lib/split-layout";
import {
  getPluginPanelRoutePluginId,
  getRootComposeRoutePath,
} from "@/lib/route-paths";
import { focusedPaneRoute } from "@/views/thread-detail/splitThreadNavigation";

export function useSetPluginEnabled() {
  const store = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const currentLocation = useRef(location);
  useLayoutEffect(() => {
    currentLocation.current = location;
  }, [location]);

  return useCallback(
    async (pluginId: string, enabled: boolean, onNavigate?: () => void) => {
      await setPluginEnabled(fetch, pluginId, enabled);
      if (enabled) return;
      const current = store.get(splitLayoutAtom);
      let next = current;
      if (next !== null) {
        for (const pane of listPanes(next.root)) {
          if (
            pane.content.kind !== "plugin-panel" ||
            pane.content.pluginId !== pluginId
          )
            continue;
          next =
            listPanes(next.root).length === 1
              ? replacePaneContent(next, pane.paneId, { kind: "new-thread" })
              : removePane(next, pane.paneId);
        }
      }
      flushSync(() => {
        if (next !== current) {
          store.set(splitLayoutAtom, next);
          const maximized = store.get(maximizedPaneIdAtom);
          if (
            maximized !== null &&
            (next === null ||
              listPanes(next.root).length < 2 ||
              findPane(next.root, maximized) === null)
          ) {
            store.set(maximizedPaneIdAtom, null);
          }
        }
        if (
          getPluginPanelRoutePluginId(currentLocation.current.pathname) ===
          pluginId
        ) {
          onNavigate?.();
          void navigate(
            (next && focusedPaneRoute(next)) ?? getRootComposeRoutePath(),
            { replace: true },
          );
        }
      });
    },
    [navigate, store],
  );
}
