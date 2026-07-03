import { useEffect } from "react";
import { bootPluginFrontends } from "../lib/plugin-frontend";
import { useSystemConfig } from "./queries/system-queries";

/**
 * Load plugin frontend bundles (plugin design §5.1) once per page load,
 * after the system config resolves the `plugins` experiment flag — the
 * loading never delays first paint. After boot, the realtime
 * `plugins-changed` broadcast keeps bundles live via
 * schedulePluginFrontendReconcile (no page refresh needed).
 */
export function usePluginFrontendBoot(): void {
  const systemConfig = useSystemConfig();
  const enabled = systemConfig.data?.experiments.plugins === true;
  useEffect(() => {
    if (enabled) void bootPluginFrontends();
  }, [enabled]);
}
