import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";
import { initializeTraceabilityIndex } from "./query.js";

export function registerRequirementsTraceabilityBackend(
  _bb: BbPluginApi,
  ctx: PluginContext,
): void {
  // The frozen requirementsList RPC remains registered by WP-36. WP-37 owns
  // its read-only discriminator branch and prepares only the local SQL index.
  initializeTraceabilityIndex(ctx.db());
}
