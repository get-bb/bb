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
import {
  authoringToolchainRpcContract,
  type ToolchainAdvisory,
} from "./toolchain-advisory-contract.js";
import { AUTHORING_TOOLCHAIN_CHANGED_CHANNEL } from "./toolchain-advisory-channel.js";

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

interface ToolchainAdvisoryChannel {
  current: ToolchainAdvisory;
}

function missingToolchainDetail(report: ToolchainReport): string {
  return (["build", "flash", "zephyr-workspace"] as const)
    .map((capability) => ({
      capability,
      tools: report.missing
        .filter((tool) => tool.unlocks === capability)
        .map((tool) => tool.id),
    }))
    .filter((entry) => entry.tools.length > 0)
    .map((entry) => `${entry.capability} missing ${entry.tools.join(", ")}`)
    .join("; ");
}

function toolchainAdvisory(report: ToolchainReport): ToolchainAdvisory {
  const detail = missingToolchainDetail(report);
  const state = report.missing.length === 0
    ? "ready"
    : report.configured
      ? "degraded"
      : "unavailable";
  const message = state === "ready"
    ? "Firmware build, flash, and Zephyr workspace helpers are available on this host."
    : state === "degraded"
      ? `Some optional firmware helpers are unavailable on this host: ${detail}.`
      : `Firmware helpers are unavailable on this host: ${detail}.`;
  return {
    state,
    configured: report.configured,
    found: report.found.map(({ id, version }) => ({ id, version })),
    missing: report.missing.map(({ id, unlocks }) => ({ id, unlocks })),
    message,
    checkedAt: new Date().toISOString(),
  };
}

export function reportToolchainConfiguration(
  bb: BbPluginApi,
  report: ToolchainReport,
): ToolchainReport {
  if (report.missing.length > 0) {
    bb.log.warn(
      `Authoring toolchain advisory: ${missingToolchainDetail(report)}. Finite State never auto-installs host prerequisites.`,
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
  const advisory = ctx.service<ToolchainAdvisoryChannel>(
    "authoring.toolchain-advisory",
    () => ({
      current: {
        state: "detecting",
        configured: false,
        found: [],
        missing: [],
        message: "Firmware helper detection is in progress.",
        checkedAt: null,
      },
    }),
  );
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
  bb.rpc.register(authoringToolchainRpcContract, {
    authoringToolchainStatus() {
      return advisory.current;
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
              if (signal.aborted) return;
              const reported = reportToolchainConfiguration(bb, report);
              advisory.current = toolchainAdvisory(reported);
              bb.realtime.publish(AUTHORING_TOOLCHAIN_CHANGED_CHANNEL, {
                state: advisory.current.state,
              });
            })
            .catch((error: unknown) => {
              if (signal.aborted) return;
              advisory.current = {
                state: "error",
                configured: false,
                found: [],
                missing: [],
                message: "Firmware helper detection failed. Review plugin logs and retry after correcting the host environment.",
                checkedAt: new Date().toISOString(),
              };
              ctx.log.warn(
                `Authoring toolchain detection failed: ${error instanceof Error ? error.message : "unknown error"}`,
              );
              bb.realtime.publish(AUTHORING_TOOLCHAIN_CHANGED_CHANNEL, {
                state: advisory.current.state,
              });
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
