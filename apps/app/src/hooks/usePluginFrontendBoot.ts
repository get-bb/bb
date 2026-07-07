import { useEffect } from "react";
import { bootPluginFrontends } from "../lib/plugin-frontend";
import { useSystemConfig } from "./queries/system-queries";

/**
 * Load plugin frontend bundles (plugin design §5.1) once per page load,
 * after system config resolves — the loading never delays first paint.
 * The server inventory already filters to running, loadable plugins; builtin
 * plugin frontends can be present even when the Plugins experiment is off.
 * After boot, the realtime
 * `plugins-changed` broadcast keeps bundles live via
 * schedulePluginFrontendReconcile (no page refresh needed).
 */
export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const resolved = systemConfig.data !== undefined;
  useEffect(() => {
    if (resolved) void bootPluginFrontends();
  }, [resolved]);
}
