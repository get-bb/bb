import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import { registerCachePuller } from "../sync/engine/adapter.js";
import { hydrateFindingActivity } from "./cache/activity.js";
import { hydrateFindingComments } from "./cache/comments.js";
import { pullFindings } from "./cache/pull.js";
import { registerFindingsBulk } from "./bulk/index.js";
import { registerFindingsDrift } from "./drift/index.js";
import { registerFindingsOverlay } from "./overlay/index.js";
import { registerFindingsPolicyStub } from "./policy/index.js";
import { registerFindingsStableKeyStub } from "./stable-key/index.js";
import { registerFindingsRpc } from "./rpc.js";

export function registerFindings(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  const remote = ctx.service<RemoteServices>("remote-services", () => {
    throw new Error("Findings registration requires remote services");
  });
  registerCachePuller("finding", async (scope, generationId, onProgress) => {
    const result = await pullFindings(
      {
        db,
        platform: remote.platform,
        warn(message, details) {
          ctx.log.warn(
            `${message}: ${details.count} for project version ${details.projectVersionId}`,
          );
        },
        quarantine({ count }) {
          ctx.log.warn(
            `Quarantined individually unkeyable Platform finding rows: ${count}`,
          );
        },
      },
      scope,
      generationId,
      (progress) => {
        onProgress({ page: progress.page, of: progress.of });
        bb.realtime.publish("fs-findings-pull", {
          pvId: scope.projectVersionId,
          ...progress,
        });
      },
    );
    return { fetched: result.fetched, baseRows: result.published };
  });
  ctx.service("findings.hydration", () => ({
    activity: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => hydrateFindingActivity(db, remote.platform, input),
    comments: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => hydrateFindingComments(db, remote.platform, input),
  }));
  registerFindingsRpc(bb, db, {
    hydrateActivity: (input) =>
      hydrateFindingActivity(db, remote.platform, input),
  });
  registerFindingsStableKeyStub(db);
  registerFindingsOverlay(ctx);
  registerFindingsPolicyStub();
  registerFindingsBulk({
    db,
    platform: remote.platform,
    publish: (progress) =>
      bb.realtime.publish("fs-vex-push-progress", progress),
  });
  registerFindingsDrift(ctx);
}
