import type { PluginContext } from "../../../lib/context.js";
import {
  registerCachePuller,
  registeredCachePullers,
} from "../../sync/engine/adapter.js";
import { classifyDrift, readDriftReport } from "./classify.js";
import { pruneOrphans } from "./orphans.js";
import { importVendorVex } from "./vendor/import.js";

export * from "./classify.js";
export * from "./orphans.js";
export * from "./report.js";
export * from "./vendor/import.js";
export * from "./vendor/map.js";
export * from "./vendor/parse.js";

export const FINDINGS_DRIFT_CHANGED_CHANNEL = "fs-findings-drift-changed";

/** Installs local drift/import services and one post-publication refetch hint. */
export function registerFindingsDrift(ctx: PluginContext): void {
  const db = ctx.db();
  const findingPuller = registeredCachePullers().find((candidate) => candidate.kind === "finding");
  if (findingPuller === undefined) throw new Error("Findings drift requires the registered findings cache puller");
  registerCachePuller("finding", async (scope, generationId, onProgress) => {
    await findingPuller.pull(scope, generationId, onProgress);
    ctx.bb.realtime.publish(FINDINGS_DRIFT_CHANGED_CHANNEL, { pvId: scope.projectVersionId });
  });
  ctx.service("findings.drift", () => ({
    refresh: (input: { root: string; projectId: string; pvId: string; limit?: number }) =>
      classifyDrift({ db, root: input.root, projectId: input.projectId, limit: input.limit }, input.pvId),
    report: (input: { root: string; projectId: string; pvId: string; cursor?: string | null; limit?: number }) =>
      readDriftReport({ db, root: input.root, projectId: input.projectId, cursor: input.cursor, limit: input.limit }, input.pvId),
    importVendorVex: (input: {
      root: string;
      projectId: string;
      pvId: string;
      file: string;
      vendor: string;
      overwrite: boolean;
      dryRun: boolean;
    }) => importVendorVex({ db, root: input.root, projectId: input.projectId, pvId: input.pvId }, input.file, input),
    pruneOrphans: (input: {
      root: string;
      projectId: string;
      pvId: string;
      stableKeys: string[];
      dryRun: boolean;
      confirmed: boolean;
      expectedBaseStateSha256: string;
    }) => pruneOrphans({ db, root: input.root, projectId: input.projectId, pvId: input.pvId }, input),
  }));
}
