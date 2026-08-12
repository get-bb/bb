import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function RequirementsTraceabilityLayer(): null {
  return null;
}

export function registerRequirementsTraceabilityBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-37 replaces this lane-local registration seam.
}
