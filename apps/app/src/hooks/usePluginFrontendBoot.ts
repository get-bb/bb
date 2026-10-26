import { useEffect } from "react";
import {
  PLUGIN_FRONTEND_BOOT_TIMEOUT_MS,
  requestBrowserIdle,
  scheduleDeferredPluginFrontendBoot,
} from "../lib/plugin-frontend-boot-schedule";
import { markPluginFrontendSettleFloorReached } from "../lib/plugin-frontend-boot-state";
import { bootPluginFrontends } from "../lib/plugin-frontend-lazy";
import { frontendPriorityPluginIds } from "../lib/plugin-surface-providers";
import { holdSplitPreloads } from "../lib/split-prefetch";
import { whenRouteContentPainted } from "../lib/route-content-paint";
import { getPluginPanelRoutePluginId } from "../lib/route-paths";
import { useSystemConfig } from "./queries/system-queries";
import { pluginListQueryOptions } from "./queries/plugin-settings-queries";
import { appQueryClient } from "../lib/app-query-client";
import { prefetchPluginModule } from "../lib/plugin-module-preload";
import { prefetchPluginCss } from "../lib/plugin-css";

export const PLUGIN_FRONTEND_SETTLE_FLOOR_MS = 15_000;
const PRIORITY_PRELOAD_HOLD_MAX_MS = 10_000;

export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const resolved = systemConfig.data !== undefined;
  useEffect(() => {
    if (!resolved) return;
    const pathname = window.location.pathname;
    const priorityPluginIds = frontendPriorityPluginIds(pathname);
    let cancelled = false;
    void appQueryClient
      .fetchQuery(pluginListQueryOptions({ enabled: true }))
      .then((plugins) => {
        if (cancelled) return;
        for (const pluginId of priorityPluginIds) {
          const plugin = plugins.find((candidate) => candidate.id === pluginId);
          if (
            !plugin?.enabled ||
            !["running", "needs-configuration", "degraded"].includes(
              plugin.status,
            )
          ) {
            continue;
          }
          const bundle = plugin.app.bundle;
          if (bundle === null || !bundle.compatible) continue;
          prefetchPluginModule(bundle.jsUrl);
          if (bundle.cssUrl !== null) prefetchPluginCss(bundle.cssUrl);
        }
      })
      .catch(() => {});
    const releaseHold =
      priorityPluginIds.length > 0 ? holdSplitPreloads() : () => {};
    const holdTimeout = window.setTimeout(
      releaseHold,
      PRIORITY_PRELOAD_HOLD_MAX_MS,
    );
    const releasePreloads = () => {
      window.clearTimeout(holdTimeout);
      releaseHold();
    };
    const cleanup = () => {
      cancelled = true;
      releasePreloads();
    };
    const boot = () => void bootPluginFrontends().then(releasePreloads);
    if (
      priorityPluginIds.length > 0 ||
      getPluginPanelRoutePluginId(pathname) !== null
    ) {
      boot();
      return cleanup;
    }
    const cancelBoot = scheduleDeferredPluginFrontendBoot(boot, {
      whenRoutePainted: whenRouteContentPainted,
      requestIdle: requestBrowserIdle,
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      timeoutMs: PLUGIN_FRONTEND_BOOT_TIMEOUT_MS,
    });
    return () => {
      cancelBoot();
      cleanup();
    };
  }, [resolved]);
  useEffect(() => {
    const timeout = window.setTimeout(
      markPluginFrontendSettleFloorReached,
      PLUGIN_FRONTEND_SETTLE_FLOOR_MS,
    );
    return () => window.clearTimeout(timeout);
  }, []);
}
