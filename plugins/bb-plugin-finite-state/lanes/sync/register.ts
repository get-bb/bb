import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { registerSyncCli } from "./cli.js";
import { registerAdapter, registerResolver } from "./engine/adapter.js";
import type { EngineDeps } from "./engine/pull.js";
import {
  createVexDecisionAdapter,
  createVexDecisionResolver,
  fastForwardVexWorking,
} from "./entities/vex-decision.js";
import { registerSyncRpc } from "./rpc.js";

export function registerSync(bb: BbPluginApi, ctx: PluginContext): void {
  const remote = ctx.service<RemoteServices>("remote-services", () => {
    throw new Error("Sync registration requires remote services");
  });
  registerAdapter(createVexDecisionAdapter(remote.platform));
  registerResolver("vexDecision", createVexDecisionResolver(remote.platform));
  const deps: EngineDeps = {
    db: ctx.db(),
    worktreeRoot: null,
    publish: (channel, progress) => ctx.bb.realtime.publish(channel, progress),
    fastForwardWorking: async ({ adapter, baseRows, files, worktreeRoot }) => {
      if (adapter.kind === "vexDecision") {
        await fastForwardVexWorking(worktreeRoot, files, baseRows);
      }
    },
  };
  registerSyncRpc(bb, deps);
  registerSyncCli(bb, deps, remote.platform);
}
