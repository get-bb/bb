import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import { REMOTE_SETTING_DESCRIPTORS } from "../../lib/remote/config.js";
import { createRemoteServiceController } from "../../lib/remote/index.js";
import { rpcContract } from "../../shared/contract.js";

const connectionsContract = { connectionsStatus: rpcContract.connectionsStatus };

export async function registerRemoteServices(
  bb: BbPluginApi,
  ctx: PluginContext,
): Promise<void> {
  const settings = bb.settings.define(REMOTE_SETTING_DESCRIPTORS);
  const initial = await settings.get();
  const controller = createRemoteServiceController(ctx, initial);
  ctx.service("remote-services", () => controller.services);
  settings.onChange((next, prev) => {
    void controller.reconfigure(next, prev);
  });
  bb.rpc.register(connectionsContract, {
    connectionsStatus() { return controller.connectionStatus(); },
  });
  bb.onDispose(() => controller.dispose());
}
