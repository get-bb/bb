import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { registerSyncCli } from "./cli.js";
import type { NamespacedCliRunner } from "./cli.js";
import { registerAdapter, registerResolver } from "./engine/adapter.js";
import type { EngineDeps } from "./engine/pull.js";
import {
  createVexDecisionAdapter,
  createVexDecisionResolver,
  fastForwardVexWorking,
} from "./entities/vex-decision.js";
import { registerSyncRpc } from "./rpc.js";

async function resolveSyncWorktreeRoot(
  ctx: PluginContext,
  cliContext: PluginCliContext,
): Promise<string> {
  if (!cliContext.threadId) {
    throw new Error(
      "SYNC_EXECUTION_CONTEXT_REQUIRED: invoke from a bb thread; cwd is not trusted as a worktree identity",
    );
  }
  const thread = await ctx.bb.sdk.threads.get({
    threadId: cliContext.threadId,
  });
  if (
    !thread.environmentId ||
    (cliContext.projectId !== undefined &&
      thread.projectId !== cliContext.projectId)
  ) {
    throw new Error(
      "SYNC_EXECUTION_CONTEXT_INVALID: thread project/environment mismatch",
    );
  }
  const environment = await ctx.bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  if (environment.projectId !== thread.projectId || !environment.path) {
    throw new Error(
      "SYNC_EXECUTION_CONTEXT_INVALID: environment has no verified workspace path",
    );
  }
  return environment.path;
}

export function registerSync(bb: BbPluginApi, ctx: PluginContext): void {
  const remote = ctx.service<RemoteServices>("remote-services", () => {
    throw new Error("Sync registration requires remote services");
  });
  registerAdapter(
    createVexDecisionAdapter(remote.platform, ctx.db(), (advisory) => {
      ctx.log.warn(
        `VEX remote row isolated: ${advisory.code}; finding=${advisory.findingId ?? "unknown"}`,
      );
    }),
  );
  registerResolver("vexDecision", createVexDecisionResolver(remote.platform));
  const deps: EngineDeps = {
    db: ctx.db(),
    worktreeRoot: null,
    publish: (channel, progress) => ctx.bb.realtime.publish(channel, progress),
    // Keep kind-specific channels so mounted consumers only invalidate the
    // accepted surface they read. The engine invokes this callback after the
    // atomic generation publish has committed.
    published: ({ scope, kinds }) => {
      if (scope.projectVersionId === null) return;
      const payload = {
        projectId: scope.projectId,
        projectVersionId: scope.projectVersionId,
      };
      if (kinds.includes("sbomComponent")) {
        ctx.bb.realtime.publish("bom:changed", {
          projectVersionId: scope.projectVersionId,
        });
      }
      if (kinds.includes("finding")) {
        ctx.bb.realtime.publish("findings:changed", payload);
      }
      if (kinds.includes("requirement")) {
        ctx.bb.realtime.publish("requirements:changed", payload);
      }
      if (kinds.includes("threat")) {
        ctx.bb.realtime.publish("tara:changed", payload);
      }
    },
    fastForwardWorking: async ({ adapter, baseRows, files, worktreeRoot }) => {
      if (adapter.kind === "vexDecision") {
        await fastForwardVexWorking(worktreeRoot, files, baseRows);
      }
    },
  };
  registerSyncRpc(bb, deps);
  registerSyncCli(
    bb,
    deps,
    remote.platform,
    (cliContext) => resolveSyncWorktreeRoot(ctx, cliContext),
    {
      firmware: (argv, cliContext) =>
        ctx
          .service<{ run: NamespacedCliRunner }>("firmware.cli", () => {
            throw new Error("Firmware CLI services are unavailable");
          })
          .run(argv, cliContext),
      bench: (argv, cliContext) =>
        ctx
          .service<{ run: NamespacedCliRunner }>("bench.cli", () => {
            throw new Error("Bench CLI services are unavailable");
          })
          .run(argv, cliContext),
    },
  );
}
