import type { PluginTrackingRangeResult } from "@bb/server-contract";
import { createPluginsClient } from "./plugin-client";

type FetchLike = typeof fetch;

export function setPluginTrackingRange(
  fetchImpl: FetchLike,
  args: { pluginId: string; range: string; dryRun: boolean },
): Promise<PluginTrackingRangeResult> {
  return createPluginsClient(fetchImpl).experimental_setTrackingRange(
    args.dryRun
      ? { pluginId: args.pluginId, range: args.range, dryRun: true }
      : { pluginId: args.pluginId, range: args.range },
  );
}
