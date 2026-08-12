import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function RequirementsConversionLayer(): null {
  return null;
}

export function registerRequirementsConversionBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-38 replaces this lane-local registration seam.
}
