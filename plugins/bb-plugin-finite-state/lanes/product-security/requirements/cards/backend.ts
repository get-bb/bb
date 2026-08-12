import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function registerRequirementsCardsBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-36 replaces this server-safe lane-local registration seam.
}
