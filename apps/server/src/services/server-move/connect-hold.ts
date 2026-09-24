import { readServerConnectHoldFile } from "@bb/server-archive";
import type { ServerLogger } from "../../types.js";
import type { PluginLoadHold } from "../plugins/plugin-runtime.js";
import { CONNECT_PLUGIN_SOURCE } from "./mode.js";

export const CONNECT_HOLD_DETAIL =
  "Off after bb server import so this server can't take the original server's tunnel. Stop the original server, run bb server allow-connect, then restart bb.";

export interface CreateConnectHoldArgs {
  dataDir: string;
  logger: Pick<ServerLogger, "warn">;
}

export function createConnectHold(args: CreateConnectHoldArgs): PluginLoadHold {
  return {
    source: CONNECT_PLUGIN_SOURCE,
    detail: CONNECT_HOLD_DETAIL,
    isActive: async () => {
      try {
        return (await readServerConnectHoldFile(args.dataDir)) !== null;
      } catch (error) {
        args.logger.warn(
          { err: error },
          "Could not read server-connect-hold.json, so bb connect stays off",
        );
        return true;
      }
    },
  };
}
