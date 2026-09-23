import { z } from "zod";
import type { AppDeps } from "../../types.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { serverAccessStatus } from "../machines/server-access.js";

export const CONNECT_PLUGIN_SOURCE = "builtin:connect";
export const BB_ACCOUNT_PLUGIN_SOURCE = "builtin:bb-account";
const CONNECT_SERVER_ACCESS_PROVIDER_ID = "connect";

const connectStatusSchema = z
  .object({
    paired: z.boolean(),
    handle: z.string().min(1).nullable(),
    url: z.string().url().nullable(),
  })
  .passthrough();

export type ServerMoveModeResolution =
  | { mode: "connect"; connectHandle: string; serverUrl: string }
  | { mode: "direct" }
  | { mode: "unavailable"; message: string };

export type ServerMoveModePlugins = Pick<
  PluginService,
  "getRpcHandler" | "invokeRpcHandler" | "list"
>;

export async function resolveServerMoveMode(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  plugins: ServerMoveModePlugins,
): Promise<ServerMoveModeResolution> {
  const access = await serverAccessStatus(deps);
  if (access.defaultProviderId !== CONNECT_SERVER_ACCESS_PROVIDER_ID) {
    return { mode: "direct" };
  }
  const connectPlugin = plugins
    .list()
    .find((plugin) => plugin.source === CONNECT_PLUGIN_SOURCE);
  if (connectPlugin === undefined) {
    return { mode: "direct" };
  }
  const handler = plugins.getRpcHandler(connectPlugin.id, "status");
  if (handler.outcome !== "found") {
    return {
      mode: "unavailable",
      message: "bb connect isn't running, so its address can't be checked.",
    };
  }
  const result = await plugins.invokeRpcHandler(
    connectPlugin.id,
    "status",
    handler.value,
    null,
  );
  if (!result.ok) {
    return { mode: "unavailable", message: result.error.message };
  }
  const status = connectStatusSchema.safeParse(result.result);
  if (!status.success) {
    return {
      mode: "unavailable",
      message: "bb connect returned an unexpected status.",
    };
  }
  if (
    !status.data.paired ||
    status.data.handle === null ||
    status.data.url === null
  ) {
    return { mode: "direct" };
  }
  return {
    mode: "connect",
    connectHandle: status.data.handle,
    serverUrl: status.data.url.replace(/\/+$/u, ""),
  };
}
