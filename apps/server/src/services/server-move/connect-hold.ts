import { readServerConnectHoldFile } from "@bb/server-archive";
import type { ServerLogger } from "../../types.js";
import type { PluginLoadHold } from "../plugins/plugin-runtime.js";
import { CONNECT_PLUGIN_SOURCE } from "./mode.js";

export const CONNECT_HOLD_DETAIL =
  "Off after bb server import so this server can't take the original server's tunnel. Stop the original server, run bb server allow-connect, then restart bb.";

const CONNECT_HOLD: PluginLoadHold = {
  source: CONNECT_PLUGIN_SOURCE,
  detail: CONNECT_HOLD_DETAIL,
};

export interface ReadConnectHoldArgs {
  dataDir: string;
  logger: Pick<ServerLogger, "warn">;
}

export async function readConnectHold(
  args: ReadConnectHoldArgs,
): Promise<PluginLoadHold | null> {
  try {
    if ((await readServerConnectHoldFile(args.dataDir)) === null) {
      return null;
    }
  } catch (error) {
    args.logger.warn(
      { err: error },
      "Could not read server-connect-hold.json, so bb connect stays off",
    );
    return CONNECT_HOLD;
  }
  args.logger.warn(
    {},
    "bb connect stays off after bb server import until bb server allow-connect removes server-connect-hold.json",
  );
  return CONNECT_HOLD;
}
