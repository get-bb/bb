import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import { toStorageProjectVersionId } from "../../lib/store/index.js";
import { rpcContract } from "../../shared/contract.js";
import { listCitationFilesNotImplemented } from "./citations/store.js";
import { listQuarantineNotImplemented } from "./citations/quarantine.js";
import { createBuildLogTailHandler } from "./build/logs.js";
import {
  cancelAuthoringJobs,
  runBuildAction,
  type BuildActionResult,
  type AuthoringContext,
} from "./build/runner.js";
import {
  clearFlashCompletedHandlers,
  runFlashAction,
  type FlashActionResult,
} from "./build/flash.js";
import {
  listBuildRuns,
  recoverOrphanedBuildRuns,
  type BuildRunChangedHint,
} from "./build/runs-store.js";
import { getAuthoringGateStatusNotImplemented } from "./workflows/state.js";
import {
  DEFAULT_TOOLCHAIN_PROBES,
  detectToolchains,
  type ToolchainReport,
} from "./build/toolchain.js";

const authoringRpcContract = {
  authoringCitationsList: rpcContract.authoringCitationsList,
  authoringQuarantineList: rpcContract.authoringQuarantineList,
  authoringGateStatus: rpcContract.authoringGateStatus,
  benchDevRunsList: rpcContract.benchDevRunsList,
} as const;

export const fsBuildService = runBuildAction;
export const fsFlashService = runFlashAction;
export const buildCommandHandler = runBuildAction;
export const flashCommandHandler = runFlashAction;

export type AuthoringBuildService = (
  ctx: AuthoringContext,
  req: { target?: string },
) => Promise<BuildActionResult>;

export type AuthoringFlashService = typeof runFlashAction;

export function reportToolchainConfiguration(
  bb: BbPluginApi,
  report: ToolchainReport,
): ToolchainReport {
  if (!report.configured) {
    bb.status.needsConfiguration(
      "Firmware build/flash toolchains are not configured on this host. Install project prerequisites and explicitly re-detect; Finite State never auto-installs them.",
    );
  }
  return report;
}

function publishBuildChanged(bb: BbPluginApi, hint: BuildRunChangedHint): void {
  bb.realtime.publish("build:changed", hint);
}

function buildRunFilters(input: object): {
  kinds: Array<"build" | "flash" | "probe">;
  statuses: Array<"queued" | "running" | "succeeded" | "failed" | "cancelled">;
} {
  const rawKinds = Reflect.get(input, "kinds");
  const rawStatuses = Reflect.get(input, "statuses");
  const kinds: Array<"build" | "flash" | "probe"> = [];
  if (Array.isArray(rawKinds)) {
    for (const kind of rawKinds) {
      if (kind === "build" || kind === "flash" || kind === "probe") {
        kinds.push(kind);
      }
    }
  }
  const statuses: Array<"queued" | "running" | "succeeded" | "failed" | "cancelled"> = [];
  if (Array.isArray(rawStatuses)) {
    for (const status of rawStatuses) {
      if (
        status === "queued" ||
        status === "running" ||
        status === "succeeded" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        statuses.push(status);
      }
    }
  }
  return { kinds, statuses };
}

export function registerAuthoring(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  const publish = (hint: BuildRunChangedHint): void => publishBuildChanged(bb, hint);
  const recovery = recoverOrphanedBuildRuns({ db, publish }).catch((error: unknown) => {
    ctx.log.error(
      `Authoring build-run recovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  });
  void detectToolchains({
    cacheKey: db,
    path: process.env.PATH ?? "",
    probes: DEFAULT_TOOLCHAIN_PROBES,
    probeTimeoutMs: 2_000,
  })
    .then((report) => reportToolchainConfiguration(bb, report))
    .catch((error: unknown) => {
      ctx.log.warn(
        `Authoring toolchain detection failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    });
  bb.rpc.register(authoringRpcContract, {
    authoringCitationsList(input) {
      return listCitationFilesNotImplemented(input);
    },
    authoringQuarantineList(input) {
      return listQuarantineNotImplemented(input);
    },
    authoringGateStatus(input) {
      return getAuthoringGateStatusNotImplemented(input);
    },
    benchDevRunsList(input) {
      const filters = buildRunFilters(input);
      const page = listBuildRuns(db, {
        projectId: input.projectId,
        projectVersionId: toStorageProjectVersionId(input.projectVersionId),
        pageSize: input.pageSize,
        cursor: input.cursor,
        kinds: filters.kinds,
        statuses: filters.statuses,
      });
      return {
        items: page.items.map((item) => ({
          projectId: item.projectId,
          projectVersionId: item.projectVersionId,
          runId: item.runId,
          kind: item.kind,
          status: item.status,
          target: item.target,
          artifact: item.artifact,
          digest: item.digest,
          startedAt: item.startedAt,
          finishedAt: null,
        })),
        total: page.total,
        cursor: page.cursor,
      };
    },
  });
  bb.http.route(
    "GET",
    "/authoring/build/log",
    createBuildLogTailHandler({ db }),
    { auth: "local" },
  );
  bb.background.service("authoring-build-supervisor", {
    async start(signal) {
      await recovery;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
  });
  bb.onDispose(() => {
    cancelAuthoringJobs(db);
    clearFlashCompletedHandlers(db);
  });
}

export type { AuthoringContext, BuildActionResult, FlashActionResult };
