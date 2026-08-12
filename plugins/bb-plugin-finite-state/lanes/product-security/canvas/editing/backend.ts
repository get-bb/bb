import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function registerCanvasEditingBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-35 replaces this server-safe lane-local registration seam.
}
