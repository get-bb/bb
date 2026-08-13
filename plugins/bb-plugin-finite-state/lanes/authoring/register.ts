import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
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
  recoverOrphanedBuildRuns,
  type BuildRunChangedHint,
} from "./build/runs-store.js";
import { getAuthoringGateStatusNotImplemented } from "./workflows/state.js";
import {
  DEFAULT_TOOLCHAIN_PROBES,
  detectToolchains,
  type ToolchainReport,
  type ToolchainProbe,
} from "./build/toolchain.js";

const authoringRpcContract = {
  authoringCitationsList: rpcContract.authoringCitationsList,
  authoringQuarantineList: rpcContract.authoringQuarantineList,
  authoringGateStatus: rpcContract.authoringGateStatus,
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

export interface AuthoringRegistrationOptions {
  toolchains: {
    path: string;
    probes: readonly ToolchainProbe[];
    probeTimeoutMs: number;
  };
}

export interface AuthoringRegistration {
  /** Resolves after the supervisor completes recovery and host detection. */
  ready: Promise<void>;
}

export function reportToolchainConfiguration(
  bb: BbPluginApi,
  report: ToolchainReport,
): ToolchainReport {
  if (!report.configured) {
    const missing = (["build", "flash", "zephyr-workspace"] as const)
      .map((capability) => ({
        capability,
        tools: report.missing
          .filter((tool) => tool.unlocks === capability)
          .map((tool) => tool.id),
      }))
      .filter((entry) => entry.tools.length > 0)
      .map((entry) => `${entry.capability} missing ${entry.tools.join(", ")}`)
      .join("; ");
    bb.status.needsConfiguration(
      `No complete firmware capability is configured on this host${missing ? `: ${missing}` : ""}. Install project prerequisites and explicitly re-detect; Finite State never auto-installs them.`,
    );
  }
  return report;
}

function publishBuildChanged(bb: BbPluginApi, hint: BuildRunChangedHint): void {
  bb.realtime.publish("build:changed", hint);
}

export function registerAuthoring(
  bb: BbPluginApi,
  ctx: PluginContext,
  options: AuthoringRegistrationOptions = {
    toolchains: {
      path: process.env.PATH ?? "",
      probes: DEFAULT_TOOLCHAIN_PROBES,
      probeTimeoutMs: 2_000,
    },
  },
): AuthoringRegistration {
  const db = ctx.db();
  const publish = (hint: BuildRunChangedHint): void => publishBuildChanged(bb, hint);
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
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
  });
  bb.http.route(
    "GET",
    "/authoring/build/log",
    createBuildLogTailHandler({ db }),
    { auth: "local" },
  );
  bb.background.service("authoring-build-supervisor", {
    async start(signal) {
      try {
        await recoverOrphanedBuildRuns({ db, publish }).catch((error: unknown) => {
          ctx.log.error(
            `Authoring build-run recovery failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        });
        if (!signal.aborted) {
          await detectToolchains({
            cacheKey: db,
            path: options.toolchains.path,
            probes: options.toolchains.probes,
            probeTimeoutMs: options.toolchains.probeTimeoutMs,
            signal,
          })
            .then((report) => {
              if (!signal.aborted) reportToolchainConfiguration(bb, report);
            })
            .catch((error: unknown) => {
              if (signal.aborted) return;
              ctx.log.warn(
                `Authoring toolchain detection failed: ${error instanceof Error ? error.message : "unknown error"}`,
              );
            });
        }
      } finally {
        resolveReady();
      }
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
  return { ready };
}

export type { AuthoringContext, BuildActionResult, FlashActionResult };
