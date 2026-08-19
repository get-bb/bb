import { useEffect } from "react";
import {
  PLUGIN_FRONTEND_BOOT_TIMEOUT_MS,
  requestBrowserIdle,
  scheduleDeferredPluginFrontendBoot,
} from "../lib/plugin-frontend-boot-schedule";
import { bootPluginFrontends } from "../lib/plugin-frontend-lazy";
import { whenRouteContentPainted } from "../lib/route-content-paint";
import { getPluginPanelRoutePluginId } from "../lib/route-paths";
import { useSystemConfig } from "./queries/system-queries";

/**
 * Load plugin frontend bundles (plugin design §5.1) once per page load.
 * Boot waits for system config, then for the first route content to paint
 * and the main thread to go idle (bounded by a timeout), so plugin
 * parse/eval never competes with the route chunk on a phone. A plugin panel
 * route boots as soon as config resolves: the plugin is the page there.
 * The server inventory already filters to running, loadable plugins.
 * After boot, the realtime `plugins-changed` broadcast keeps bundles live via
 * schedulePluginFrontendReconcile (no page refresh needed).
 */
export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const resolved = systemConfig.data !== undefined;
  useEffect(() => {
    if (!resolved) return;
    if (getPluginPanelRoutePluginId(window.location.pathname) !== null) {
      void bootPluginFrontends();
      return;
    }
    return scheduleDeferredPluginFrontendBoot(
      () => void bootPluginFrontends(),
      {
        whenRoutePainted: whenRouteContentPainted,
        requestIdle: requestBrowserIdle,
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        timeoutMs: PLUGIN_FRONTEND_BOOT_TIMEOUT_MS,
      },
    );
  }, [resolved]);
}
