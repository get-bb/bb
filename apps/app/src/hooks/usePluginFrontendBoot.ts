import { useEffect } from "react";
import {
  PLUGIN_FRONTEND_BOOT_TIMEOUT_MS,
  requestBrowserIdle,
  scheduleDeferredPluginFrontendBoot,
} from "../lib/plugin-frontend-boot-schedule";
import { markPluginFrontendSettleFloorReached } from "../lib/plugin-frontend-boot-state";
import {
  bootPluginFrontends,
  preloadPluginFrontend,
} from "../lib/plugin-frontend-lazy";
import { frontendPriorityPluginIds } from "../lib/plugin-surface-providers";
import { holdSplitPreloads } from "../lib/split-prefetch";
import { whenScreenPainted } from "../lib/screen-paint";
import { getPluginPanelRoutePluginId } from "../lib/route-paths";
import { namesPlugin, restoredPageLazyParts } from "../lib/restored-lazy-parts";
import { useSystemConfig } from "./queries/system-queries";
import { pluginListQueryOptions } from "./queries/plugin-settings-queries";
import { appQueryClient } from "../lib/app-query-client";
import { prefetchPluginModule } from "../lib/plugin-module-preload";
import { prefetchPluginCss } from "../lib/plugin-css";
import { warmPluginRuntimeGroups } from "../lib/plugin-runtime-groups";

export const PLUGIN_FRONTEND_SETTLE_FLOOR_MS = 15_000;
const PRIORITY_PRELOAD_HOLD_MAX_MS = 10_000;

export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const resolved = systemConfig.data !== undefined;
  useEffect(() => {
    const pathname = window.location.pathname;
    const priorityPluginIds = frontendPriorityPluginIds(pathname);
    const pageParts = restoredPageLazyParts(pathname);
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
          warmPluginRuntimeGroups(bundle.runtimeSlots);
          prefetchPluginModule(bundle.jsUrl);
          for (const url of bundle.staticChunkUrls) prefetchPluginModule(url);
          if (bundle.cssUrl !== null) prefetchPluginCss(bundle.cssUrl);
          if (pageParts.some((part) => namesPlugin(part, pluginId))) {
            for (const url of bundle.lazyChunkUrls) prefetchPluginModule(url);
          }
        }
      })
      .catch(() => {});
    if (
      priorityPluginIds.length > 0 ||
      getPluginPanelRoutePluginId(pathname) !== null
    ) {
      preloadPluginFrontend();
    }
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!resolved) return;
    const pathname = window.location.pathname;
    const priorityPluginIds = frontendPriorityPluginIds(pathname);
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
      whenScreenPainted: whenScreenPainted,
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
