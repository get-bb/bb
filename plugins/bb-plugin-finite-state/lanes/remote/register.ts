import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import {
  publishRemoteSettings,
  REMOTE_SETTING_DESCRIPTORS,
  standaloneUnpackConfigChanged,
} from "../../lib/remote/config.js";
import { createRemoteServiceController } from "../../lib/remote/index.js";
import { rpcContract } from "../../shared/contract.js";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "./connection-state.js";
import { remoteDiagnosticsRpcContract } from "./diagnostics-contract.js";

const connectionsContract = {
  connectionsStatus: rpcContract.connectionsStatus,
};

export async function registerRemoteServices(
  bb: BbPluginApi,
  ctx: PluginContext,
): Promise<void> {
  const settings = bb.settings.define(REMOTE_SETTING_DESCRIPTORS);
  const initial = await settings.get();
  publishRemoteSettings(ctx, initial);
  const controller = createRemoteServiceController(ctx, initial);
  ctx.service("remote-services", () => controller.services);
  settings.onChange((next, prev) => {
    if (standaloneUnpackConfigChanged(next, prev))
      publishRemoteSettings(ctx, next);
    void controller
      .reconfigure(next, prev)
      .then(() => {
        bb.realtime.publish(REMOTE_CONNECTIONS_CHANGED_CHANNEL, null);
      })
      .catch(() => {
        bb.log.warn("Finite State remote service reconfiguration failed.");
        bb.realtime.publish(REMOTE_CONNECTIONS_CHANGED_CHANNEL, null);
      });
  });
  bb.rpc.register(connectionsContract, {
    connectionsStatus() {
      return controller.connectionStatus();
    },
  });
  bb.rpc.register(remoteDiagnosticsRpcContract, {
    remoteConnectionDiagnostics() {
      return controller.connectionDiagnostics();
    },
  });
  bb.onDispose(() => controller.dispose());
}
