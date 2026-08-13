import { defineRpcContract, type BbPluginApi, type PluginCliContext } from "@bb/plugin-sdk";
import { z } from "zod";
import type { PluginContext } from "../../lib/context.js";
import { rpcContract } from "../../shared/contract.js";
import { getHwStatus, type PageQuery } from "./hw-status.js";
import {
  claimDevice,
  refreshClaim,
  releaseDevice,
  type ClaimResult,
} from "./registry/claims.js";
import { enumerateDevices, type BenchContext } from "./registry/enumerate.js";
import {
  familyDescriptor,
  type DeviceKind,
  type FamilyStatus,
} from "./registry/families.js";
import {
  confirmHelperInstall,
  proposeHelperInstall,
  type HelperInstallOutcome,
  type HelperInstallProposal,
} from "./registry/helpers.js";
import {
  BENCH_CHANGED_CHANNEL,
  initializeRegistryStore,
  listDevices,
  listFamilyStatuses,
  type RegistryScope,
} from "./registry/store.js";
import { listBenchDevelopmentRuns } from "./probes/runs.js";
import { getSerialSession } from "./serial/session.js";

const projectScopeFields = {
  projectId: z.string().min(1).max(512),
  projectVersionId: z.string().min(1).max(512).nullable(),
} as const;
const familyStatusSchema = z.object({
  familyId: z.string().min(1).max(200),
  kind: z.enum(["probe", "logic", "power", "scope", "serial"]),
  label: z.string().min(1).max(200),
  availability: z.enum(["available", "unavailable"]),
  reason: z.string().max(2000).nullable(),
  helper: z.object({
    id: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    source: z.string().min(1).max(2000),
    why: z.string().min(1).max(2000),
  }).strict(),
  needsConfiguration: z.boolean(),
  checkedAt: z.iso.datetime(),
}).strict();
const registryStatusSchema = z.object({
  families: z.array(familyStatusSchema).max(20),
  deviceCount: z.number().int().nonnegative(),
  scannedAt: z.iso.datetime().nullable(),
}).strict();
const proposalSchema = z.object({
  proposalToken: z.string().min(1).max(512),
  familyId: z.string().min(1).max(200),
  helperId: z.string().min(1).max(200),
  helperName: z.string().min(1).max(200),
  source: z.string().min(1).max(2000),
  why: z.string().min(1).max(2000),
  command: z.string().min(1).max(2000),
  proposedAt: z.iso.datetime(),
}).strict();
const installOutcomeSchema = z.object({
  proposalToken: z.string().min(1).max(512),
  familyId: z.string().min(1).max(200),
  helperId: z.string().min(1).max(200),
  state: z.enum(["installed", "failed"]),
  confirmedBy: z.string().min(1).max(512),
  message: z.string().max(1000).nullable(),
  completedAt: z.iso.datetime(),
}).strict();

export const debugBenchRpcContract = defineRpcContract({
  benchDevRegistryStatus: {
    input: z.object(projectScopeFields).strict(),
    output: registryStatusSchema,
  },
  benchDevRegistryRescan: {
    input: z.object(projectScopeFields).strict(),
    output: registryStatusSchema,
  },
  benchDevHelperProposal: {
    input: z.object({ ...projectScopeFields, familyId: z.string().min(1).max(200) }).strict(),
    output: proposalSchema,
  },
  benchDevHelperInstall: {
    input: z.object({
      ...projectScopeFields,
      proposalToken: z.string().min(1).max(512),
      confirmed: z.literal(true),
      confirmedBy: z.string().min(1).max(512),
    }).strict(),
    output: installOutcomeSchema,
  },
} as const);

const frozenDebugBenchRpcContract = {
  benchDevDevicesList: rpcContract.benchDevDevicesList,
  benchDevDeviceClaim: rpcContract.benchDevDeviceClaim,
  benchDevDeviceRelease: rpcContract.benchDevDeviceRelease,
  benchDevRunsList: rpcContract.benchDevRunsList,
  benchDevSerialSessionGet: rpcContract.benchDevSerialSessionGet,
} as const;

const DEVICE_KINDS = new Set<string>(["probe", "logic", "power", "scope", "serial"]);

function frozenKinds(input: object): DeviceKind[] | undefined {
  const value: unknown = Reflect.get(input, "kinds");
  if (!Array.isArray(value)) return undefined;
  const kinds: DeviceKind[] = [];
  for (const item of value) {
    if (typeof item === "string" && DEVICE_KINDS.has(item)) {
      if (item === "probe" || item === "logic" || item === "power" || item === "scope" || item === "serial") {
        kinds.push(item);
      }
    }
  }
  return kinds;
}

function frozenIncludeStale(input: object): boolean {
  const value: unknown = Reflect.get(input, "includeStale");
  return typeof value === "boolean" ? value : true;
}

export interface FsHwStatusService {
  status(query: PageQuery): ReturnType<typeof getHwStatus>;
}

export interface DebugBenchCommandHandlers {
  devices(query: PageQuery): ReturnType<typeof getHwStatus>;
  claim(scope: RegistryScope, deviceId: string, holder: string): ClaimResult;
  release(scope: RegistryScope, deviceId: string, holder: string): ClaimResult;
  refresh(scope: RegistryScope, deviceId: string, holder: string): void;
  rescan(scope: RegistryScope): Promise<{ families: FamilyStatus[]; deviceCount: number }>;
  proposeHelper(familyId: string): HelperInstallProposal;
  installHelper(
    proposalToken: string,
    confirmedBy: string,
  ): Promise<HelperInstallOutcome>;
  cliContextHolder(context: PluginCliContext): string;
}

class RegistryCoordinator {
  private readonly scopes = new Map<string, RegistryScope>();

  constructor(
    private readonly bb: BbPluginApi,
    private readonly ctx: PluginContext,
  ) {
    initializeRegistryStore(ctx.db());
  }

  remember(scope: RegistryScope): void {
    this.scopes.set(`${scope.projectId}\0${scope.projectVersionId ?? ""}`, scope);
  }

  benchContext(scope: RegistryScope): BenchContext {
    this.remember(scope);
    return { ...scope, db: this.ctx.db(), log: this.ctx.log };
  }

  async rescan(scope: RegistryScope): Promise<{ families: FamilyStatus[]; deviceCount: number }> {
    const result = await enumerateDevices(this.benchContext(scope));
    for (const device of result.devices) {
      this.bb.realtime.publish(BENCH_CHANGED_CHANNEL, { deviceId: device.deviceId });
    }
    return { families: result.families, deviceCount: result.devices.length };
  }

  status(scope: RegistryScope): {
    families: FamilyStatus[];
    deviceCount: number;
    scannedAt: string | null;
  } {
    this.remember(scope);
    const families = listFamilyStatuses(this.ctx.db(), scope);
    return {
      families,
      deviceCount: listDevices(this.ctx.db(), { ...scope, pageSize: 1 }).total,
      scannedAt: families.map((family) => family.checkedAt).sort().at(-1) ?? null,
    };
  }

  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 5 * 60_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      if (signal.aborted) return;
      for (const scope of this.scopes.values()) {
        try {
          await this.rescan(scope);
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          this.ctx.log.warn(`Debug-bench background rescan failed: ${message}`);
        }
      }
    }
  }
}

function coordinatorFor(bb: BbPluginApi, ctx: PluginContext): RegistryCoordinator {
  return ctx.service("debug-bench.registry", () => new RegistryCoordinator(bb, ctx));
}

export function createFsHwStatusService(
  bb: BbPluginApi,
  ctx: PluginContext,
): FsHwStatusService {
  const coordinator = coordinatorFor(bb, ctx);
  return {
    status(query) {
      coordinator.remember(query);
      return getHwStatus(
        {
          ...query,
          db: ctx.db(),
          onExpired(deviceIds) {
            for (const deviceId of deviceIds) {
              bb.realtime.publish(BENCH_CHANGED_CHANNEL, { deviceId });
            }
          },
        },
        query,
      );
    },
  };
}

export function createDebugBenchCommandHandlers(
  bb: BbPluginApi,
  ctx: PluginContext,
): DebugBenchCommandHandlers {
  const coordinator = coordinatorFor(bb, ctx);
  const hwStatus = createFsHwStatusService(bb, ctx);
  return {
    devices: (query) => hwStatus.status(query),
    claim(scope, deviceId, holder) {
      coordinator.remember(scope);
      const result = claimDevice(ctx.db(), deviceId, holder, { scope, claimScope: "machine" });
      bb.realtime.publish(BENCH_CHANGED_CHANNEL, { deviceId });
      return result;
    },
    release(scope, deviceId, holder) {
      coordinator.remember(scope);
      const result = releaseDevice(ctx.db(), deviceId, holder, { scope });
      bb.realtime.publish(BENCH_CHANGED_CHANNEL, { deviceId });
      return result;
    },
    refresh(scope, deviceId, holder) {
      coordinator.remember(scope);
      refreshClaim(ctx.db(), deviceId, holder, { scope });
      bb.realtime.publish(BENCH_CHANGED_CHANNEL, { deviceId });
    },
    async rescan(scope) {
      const result = await coordinator.rescan(scope);
      return { families: result.families, deviceCount: result.deviceCount };
    },
    proposeHelper(familyId) {
      const family = familyDescriptor(familyId);
      if (!family) throw new Error(`UNKNOWN_DEVICE_FAMILY:${familyId}`);
      return proposeHelperInstall(ctx.db(), family);
    },
    async installHelper(proposalToken, confirmedBy) {
      return confirmHelperInstall(ctx.db(), proposalToken, {
        confirmed: true,
        confirmedBy,
      });
    },
    cliContextHolder(context) {
      if (!context.threadId) {
        throw new Error("DEVICE_HOLDER_CONTEXT_REQUIRED: invoke from a bb thread");
      }
      return context.threadId;
    },
  };
}

export function registerDebugBench(bb: BbPluginApi, ctx: PluginContext): void {
  const coordinator = coordinatorFor(bb, ctx);
  const commands = ctx.service<DebugBenchCommandHandlers>(
    "debug-bench.commands",
    () => createDebugBenchCommandHandlers(bb, ctx),
  );
  ctx.service<FsHwStatusService>(
    "debug-bench.fs-hw-status",
    () => createFsHwStatusService(bb, ctx),
  );

  bb.background.service("debug-bench-rescan", {
    start: (signal) => coordinator.start(signal),
  });

  bb.rpc.register(frozenDebugBenchRpcContract, {
    benchDevDevicesList(input) {
      coordinator.remember(input);
      return listDevices(ctx.db(), {
        ...input,
        pageSize: input.pageSize,
        cursor: input.cursor,
        kinds: frozenKinds(input),
        includeStale: frozenIncludeStale(input),
      });
    },
    benchDevDeviceClaim(input) {
      const result = commands.claim(input, input.deviceId, input.holder);
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        device: result.device,
        outcome: result.outcome,
      };
    },
    benchDevDeviceRelease(input) {
      const result = commands.release(input, input.deviceId, input.holder);
      return {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        device: result.device,
        outcome: result.outcome,
      };
    },
    benchDevRunsList: (input) => listBenchDevelopmentRuns(ctx.db(), input),
    benchDevSerialSessionGet: (input) => getSerialSession(ctx.db(), input),
  });

  bb.rpc.register(debugBenchRpcContract, {
    benchDevRegistryStatus: (input) => coordinator.status(input),
    async benchDevRegistryRescan(input) {
      const result = await commands.rescan(input);
      return {
        ...result,
        scannedAt: result.families.map((family) => family.checkedAt).sort().at(-1) ?? null,
      };
    },
    benchDevHelperProposal(input) {
      const status = coordinator.status(input).families
        .find((family) => family.familyId === input.familyId);
      if (!status?.needsConfiguration) {
        throw new Error(`HELPER_INSTALL_NOT_REQUIRED:${input.familyId}`);
      }
      return commands.proposeHelper(input.familyId);
    },
    async benchDevHelperInstall(input) {
      const outcome = await commands.installHelper(input.proposalToken, input.confirmedBy);
      await commands.rescan(input);
      return outcome;
    },
  });
}
