import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";

export async function registerRemoteServices(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): Promise<void> {
  // TODO(L1): direct clients, optional compute, settings/health. See WP-14.
}
