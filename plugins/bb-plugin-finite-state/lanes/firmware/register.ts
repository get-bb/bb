import type { BbPluginApi, PluginCliContext } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import { rpcContract } from "../../shared/contract.js";
import { materializeFromApi, hydrateFirmwareFile } from "./api/fallback.js";
import {
  linkNode,
  type FirmwareExecutionScope,
  type LinkNodeResult,
  putBlob,
} from "./cache/blob-store.js";
import { validateWorktreeRoot } from "./cache/layout.js";
import {
  commitFirmwareMount,
  type CommitFirmwareMountInput,
} from "./cache/mount-registry.js";
import {
  type FirmwareManifest,
  type FirmwareMount,
  type FirmwareNode,
  getMountReadiness,
  openManifest,
  verifyMountIntegrity,
} from "./cache/manifest.js";
import { diffFirmware } from "./diff.js";
import { getFirmwareStatus, listFirmwareMounts, listFirmwareTree, getFirmwareFile } from "./status.js";
import { runStandaloneUnpack } from "./unpack/driver.js";

const firmwareRpcContract = {
  firmwareMountsList: rpcContract.firmwareMountsList,
  firmwareMountGet: rpcContract.firmwareMountGet,
  firmwareTreeList: rpcContract.firmwareTreeList,
  firmwareFileGet: rpcContract.firmwareFileGet,
  firmwareDiff: rpcContract.firmwareDiff,
  firmwareMaterializeStart: rpcContract.firmwareMaterializeStart,
  firmwareMaterializeCancel: rpcContract.firmwareMaterializeCancel,
  firmwareFileHydrate: rpcContract.firmwareFileHydrate,
} as const;

export type { FirmwareExecutionScope } from "./cache/blob-store.js";

export interface FirmwareCacheService {
  open(scope: FirmwareExecutionScope): FirmwareManifest;
  putBlob(
    scope: FirmwareExecutionScope,
    source: NodeJS.ReadableStream,
    expectedSha256: string,
  ): Promise<{ path: string; reused: boolean }>;
  linkNode(
    scope: FirmwareExecutionScope,
    mount: FirmwareMount,
    node: FirmwareNode,
    blobPath: string,
  ): Promise<LinkNodeResult>;
  commit(input: CommitFirmwareMountInput): void;
  readiness(manifest: FirmwareManifest): ReturnType<typeof getMountReadiness>;
  verifyIntegrity(manifest: FirmwareManifest): ReturnType<typeof verifyMountIntegrity>;
}

function assertScope(scope: FirmwareExecutionScope): FirmwareExecutionScope {
  if (!scope.projectId || !scope.generationId || scope.projectVersionId !== scope.projectVersionId.trim()) {
    throw new Error("FIRMWARE_SCOPE_INVALID: explicit project and generation scope is required");
  }
  return { ...scope, worktreeRoot: validateWorktreeRoot(scope.worktreeRoot) };
}

export function createFirmwareCacheService(ctx: PluginContext): FirmwareCacheService {
  return {
    open(scope) {
      const verified = assertScope(scope);
      return openManifest(verified.worktreeRoot, verified.projectVersionId);
    },
    putBlob(scope, source, expectedSha256) {
      const verified = assertScope(scope);
      return putBlob(verified.worktreeRoot, source, expectedSha256);
    },
    linkNode(scope, mount, node, blobPath) {
      return linkNode(assertScope(scope), mount, node, blobPath);
    },
    commit(input) {
      commitFirmwareMount(ctx.db(), input);
    },
    readiness: getMountReadiness,
    verifyIntegrity: verifyMountIntegrity,
  };
}

export async function resolveFirmwareExecutionScope(
  ctx: PluginContext,
  input: {
    threadId: string;
    projectId: string;
    projectVersionId: string;
    generationId: string;
  },
): Promise<FirmwareExecutionScope> {
  const thread = await ctx.bb.sdk.threads.get({ threadId: input.threadId });
  if (thread.projectId !== input.projectId || !thread.environmentId) {
    throw new Error("FIRMWARE_EXECUTION_CONTEXT_INVALID: thread project/environment mismatch");
  }
  const environment = await ctx.bb.sdk.environments.get({ environmentId: thread.environmentId });
  if (environment.projectId !== input.projectId || !environment.path) {
    throw new Error("FIRMWARE_EXECUTION_CONTEXT_INVALID: environment has no verified workspace path");
  }
  return assertScope({
    worktreeRoot: environment.path,
    projectId: input.projectId,
    projectVersionId: input.projectVersionId,
    generationId: input.generationId,
  });
}
export function createFirmwareCommandHandlers(ctx: PluginContext) {
  return {
    async resolveScope(
      cliContext: PluginCliContext,
      input: Omit<Parameters<typeof resolveFirmwareExecutionScope>[1], "threadId">,
    ): Promise<FirmwareExecutionScope> {
      if (!cliContext.threadId) {
        throw new Error(
          "FIRMWARE_EXECUTION_CONTEXT_REQUIRED: invoke from a bb thread; cwd is not trusted as a worktree identity",
        );
      }
      return resolveFirmwareExecutionScope(ctx, { ...input, threadId: cliContext.threadId });
    },
    cache: ctx.service("firmware.cache", () => createFirmwareCacheService(ctx)),
  };
}

export function createFirmwareMaterializationActionService(ctx: PluginContext) {
  return {
    async resolveScope(
      toolContext: { threadId: string; projectId: string },
      input: { projectVersionId: string; generationId: string },
    ): Promise<FirmwareExecutionScope> {
      return resolveFirmwareExecutionScope(ctx, {
        ...input,
        threadId: toolContext.threadId,
        projectId: toolContext.projectId,
      });
    },
    cache: ctx.service("firmware.cache", () => createFirmwareCacheService(ctx)),
  };
}

class FirmwareBackgroundCoordinator {
  async start(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  }

  cancel(): never {
    throw new Error("NOT_IMPLEMENTED: firmware job cancellation is owned by WP-48/WP-49");
  }
}

export function registerFirmware(bb: BbPluginApi, ctx: PluginContext): void {
  const cache = ctx.service("firmware.cache", () => createFirmwareCacheService(ctx));
  const coordinator = ctx.service("firmware.background", () => new FirmwareBackgroundCoordinator());
  void cache;

  bb.background.service("firmware-materialization", {
    start: (signal) => coordinator.start(signal),
  });
  bb.rpc.register(firmwareRpcContract, {
    firmwareMountsList: listFirmwareMounts,
    firmwareMountGet: getFirmwareStatus,
    firmwareTreeList: listFirmwareTree,
    firmwareFileGet: getFirmwareFile,
    firmwareDiff: diffFirmware,
    firmwareMaterializeStart(input) {
      return input.source === "standalone_unpack"
        ? runStandaloneUnpack(input)
        : materializeFromApi(input);
    },
    firmwareMaterializeCancel() {
      return coordinator.cancel();
    },
    firmwareFileHydrate: hydrateFirmwareFile,
  });
}
