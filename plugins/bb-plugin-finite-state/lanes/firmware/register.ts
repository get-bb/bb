import { randomUUID } from "node:crypto";
import { accessSync, constants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
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
import {
  FirmwareCacheError,
  validatePvId,
  validateWorktreeRoot,
} from "./cache/layout.js";
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
import {
  runStandaloneUnpack,
  type StandaloneUnpackWrapperConfig,
} from "./unpack/driver.js";
import type { FirmwareProgress } from "./unpack/progress.js";
import { redactHostPaths } from "./unpack/progress.js";

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

interface ActionJob {
  projectId: string;
  projectVersionId: string | null;
  id: string;
  state: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT";
  progress: number | null;
  message: string | null;
}

export interface StandaloneUnpackInputRecord {
  firmwarePath: string;
  worktreeRoot: string;
  projectId: string;
  projectVersionId: string;
  expiresAt: Date;
}

interface StoredStandaloneUnpackInput extends StandaloneUnpackInputRecord {
  consumed: boolean;
}

export class StandaloneUnpackInputRegistry {
  readonly #records = new Map<string, StoredStandaloneUnpackInput>();
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(input?: { now?: () => Date; createId?: () => string }) {
    this.#now = input?.now ?? (() => new Date());
    this.#createId = input?.createId ?? randomUUID;
  }

  issue(record: StandaloneUnpackInputRecord): string {
    const inputId = this.#createId();
    if (this.#records.has(inputId)) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_ID_COLLISION",
        "A unique firmware input id could not be issued.",
      );
    }
    if (record.expiresAt.getTime() <= this.#now().getTime()) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_EXPIRED",
        "The verified firmware input has expired.",
      );
    }
    let firmwarePath: string;
    try {
      if (!isAbsolute(record.firmwarePath)) throw new Error("not absolute");
      firmwarePath = realpathSync(record.firmwarePath);
      const file = lstatSync(firmwarePath);
      if (!file.isFile() || file.isSymbolicLink()) {
        throw new Error("not a regular file");
      }
      accessSync(firmwarePath, constants.R_OK);
    } catch (error) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_INVALID",
        "The verified firmware input must be a readable regular file.",
        { cause: error },
      );
    }
    this.#records.set(inputId, {
      ...record,
      firmwarePath,
      worktreeRoot: validateWorktreeRoot(record.worktreeRoot),
      consumed: false,
    });
    return inputId;
  }

  consume(input: {
    inputId: string;
    projectId: string;
    projectVersionId: string;
  }): StandaloneUnpackInputRecord {
    const record = this.#records.get(input.inputId);
    if (!record) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_UNKNOWN",
        "The verified firmware input id is unknown.",
      );
    }
    if (record.consumed) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_REUSED",
        "The verified firmware input id was already used.",
      );
    }
    if (record.expiresAt.getTime() <= this.#now().getTime()) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_EXPIRED",
        "The verified firmware input has expired.",
      );
    }
    if (
      record.projectId !== input.projectId ||
      record.projectVersionId !== input.projectVersionId
    ) {
      throw new FirmwareCacheError(
        "FIRMWARE_INPUT_SCOPE_MISMATCH",
        "The verified firmware input does not belong to this project version.",
      );
    }
    record.consumed = true;
    return {
      firmwarePath: record.firmwarePath,
      worktreeRoot: record.worktreeRoot,
      projectId: record.projectId,
      projectVersionId: record.projectVersionId,
      expiresAt: record.expiresAt,
    };
  }
}

export interface StandaloneUnpackRuntimeConfig {
  wrapper: StandaloneUnpackWrapperConfig;
  now?: () => Date;
  createJobId?: () => string;
  createGenerationId?: () => string;
}

interface StandaloneStartInput {
  projectId: string;
  projectVersionId: string | null;
  source: "standalone_unpack";
  inputId: string;
  maxDepth: number;
}

interface FirmwareJob {
  action: ActionJob;
  input: StandaloneStartInput & { projectVersionId: string };
  record: StandaloneUnpackInputRecord;
  controller: AbortController;
}

class FirmwareBackgroundCoordinator {
  readonly #ctx: PluginContext;
  readonly #cache: FirmwareCacheService;
  readonly #inputs: StandaloneUnpackInputRegistry;
  readonly #jobs = new Map<string, FirmwareJob>();
  readonly #queue: FirmwareJob[] = [];
  #runtime: StandaloneUnpackRuntimeConfig | null = null;
  #wake: (() => void) | null = null;

  constructor(
    ctx: PluginContext,
    cache: FirmwareCacheService,
    inputs: StandaloneUnpackInputRegistry,
  ) {
    this.#ctx = ctx;
    this.#cache = cache;
    this.#inputs = inputs;
  }

  configure(runtime: StandaloneUnpackRuntimeConfig): void {
    this.#runtime = runtime;
  }

  enqueue(input: StandaloneStartInput): ActionJob {
    if (!this.#runtime) {
      throw new FirmwareCacheError(
        "UNPACK_CONFIGURATION_REQUIRED",
        "Standalone unpack requires a configured wrapper and FACT image.",
      );
    }
    if (input.projectVersionId === null) {
      throw new FirmwareCacheError(
        "INVALID_MOUNT_SCOPE",
        "Standalone unpack requires a project version.",
      );
    }
    const record = this.#inputs.consume({
      inputId: input.inputId,
      projectId: input.projectId,
      projectVersionId: input.projectVersionId,
    });
    const id = validatePvId((this.#runtime.createJobId ?? randomUUID)());
    if (this.#jobs.has(id)) {
      throw new FirmwareCacheError(
        "FIRMWARE_JOB_ID_COLLISION",
        "A unique firmware materialization job id could not be issued.",
      );
    }
    const job: FirmwareJob = {
      input: { ...input, projectVersionId: input.projectVersionId },
      record,
      controller: new AbortController(),
      action: {
        projectId: input.projectId,
        projectVersionId: input.projectVersionId,
        id,
        state: "QUEUED",
        progress: null,
        message: "Queued standalone firmware unpack.",
      },
    };
    this.#jobs.set(id, job);
    this.#queue.push(job);
    this.#wake?.();
    return { ...job.action };
  }

  async start(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const job = this.#queue.shift();
      if (job) {
        if (job.action.state === "QUEUED") await this.#run(job, signal);
        continue;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener("abort", wake);
          this.#wake = null;
          resolve();
        };
        this.#wake = wake;
        signal.addEventListener("abort", wake, { once: true });
      });
    }
  }

  cancel(input: {
    projectId: string;
    projectVersionId: string | null;
    jobId: string;
  }): ActionJob {
    const job = this.#jobs.get(input.jobId);
    if (
      !job ||
      job.action.projectId !== input.projectId ||
      job.action.projectVersionId !== input.projectVersionId
    ) {
      throw new FirmwareCacheError(
        "FIRMWARE_JOB_UNKNOWN",
        "The firmware materialization job is unknown in this scope.",
      );
    }
    if (job.action.state === "QUEUED" || job.action.state === "RUNNING") {
      job.controller.abort();
      job.action.state = "FAILED";
      job.action.message = "Standalone firmware unpack was cancelled.";
      job.action.progress = null;
    }
    return { ...job.action };
  }

  async #run(job: FirmwareJob, serviceSignal: AbortSignal): Promise<void> {
    const runtime = this.#runtime!;
    const now = runtime.now ?? (() => new Date());
    const abort = () => job.controller.abort(serviceSignal.reason);
    if (serviceSignal.aborted) abort();
    else serviceSignal.addEventListener("abort", abort, { once: true });
    job.action.state = "RUNNING";
    job.action.message = "Running standalone firmware unpack.";
    const startedAt = now().toISOString();
    this.#ctx
      .db()
      .prepare(
        `INSERT INTO pull_generation (
          project_id, project_version_id, generation_id, status,
          requested_kinds_json, started_at
        ) VALUES (?, ?, ?, 'staging', '["firmware"]', ?)`,
      )
      .run(
        job.input.projectId,
        job.input.projectVersionId,
        job.action.id,
        startedAt,
      );
    const publishProgress = (progress: FirmwareProgress) => {
      if (job.action.state !== "RUNNING") return;
      job.action.progress =
        progress.total > 0 ? progress.done / progress.total : null;
      job.action.message = `Standalone firmware unpack: ${progress.phase}.`;
      this.#ctx.bb.realtime.publish("fs-firmware-progress", progress);
    };
    try {
      await runStandaloneUnpack(
        {
          scope: {
            worktreeRoot: job.record.worktreeRoot,
            projectId: job.input.projectId,
            projectVersionId: job.input.projectVersionId,
            generationId: job.action.id,
          },
          cache: this.#cache,
          wrapper: runtime.wrapper,
          publishProgress,
          isExplicitlySelected: (path) => path === job.record.firmwarePath,
          now,
          ...(runtime.createGenerationId === undefined
            ? {}
            : { createGenerationId: runtime.createGenerationId }),
        },
        {
          pvId: job.input.projectVersionId,
          firmwarePath: job.record.firmwarePath,
          maxDepth: job.input.maxDepth,
        },
        job.controller.signal,
      );
      if (job.controller.signal.aborted) {
        throw new FirmwareCacheError(
          "UNPACK_CANCELLED",
          "Standalone unpack was cancelled.",
        );
      }
      job.action.state = "COMPLETED";
      job.action.progress = 1;
      job.action.message = "Standalone firmware unpack completed.";
      this.#ctx
        .db()
        .prepare(
          "UPDATE pull_generation SET status='accepted', completed_at=? WHERE project_id=? AND project_version_id=? AND generation_id=?",
        )
        .run(
          now().toISOString(),
          job.input.projectId,
          job.input.projectVersionId,
          job.action.id,
        );
    } catch (error) {
      const cancelled = job.controller.signal.aborted;
      job.action.state =
        error instanceof FirmwareCacheError && error.code === "UNPACK_TIMEOUT"
          ? "TIMEOUT"
          : "FAILED";
      job.action.progress = null;
      job.action.message = cancelled
        ? "Standalone firmware unpack was cancelled."
        : redactHostPaths(
            error instanceof Error ? error.message : "Standalone firmware unpack failed.",
            [
              job.record.worktreeRoot,
              job.record.firmwarePath,
              runtime.wrapper.executablePath,
            ],
          ).slice(0, 20_000);
      this.#ctx
        .db()
        .prepare(
          "UPDATE pull_generation SET status=?, completed_at=?, error=? WHERE project_id=? AND project_version_id=? AND generation_id=?",
        )
        .run(
          cancelled ? "cancelled" : "failed",
          now().toISOString(),
          job.action.message,
          job.input.projectId,
          job.input.projectVersionId,
          job.action.id,
        );
    } finally {
      serviceSignal.removeEventListener("abort", abort);
    }
  }
}

export function getStandaloneUnpackInputRegistry(
  ctx: PluginContext,
): StandaloneUnpackInputRegistry {
  return ctx.service(
    "firmware.unpack-inputs",
    () => new StandaloneUnpackInputRegistry(),
  );
}

function getFirmwareBackgroundCoordinator(
  ctx: PluginContext,
): FirmwareBackgroundCoordinator {
  const cache = ctx.service("firmware.cache", () =>
    createFirmwareCacheService(ctx),
  );
  return ctx.service(
    "firmware.background",
    () =>
      new FirmwareBackgroundCoordinator(
        ctx,
        cache,
        getStandaloneUnpackInputRegistry(ctx),
      ),
  );
}

export function configureStandaloneUnpackRuntime(
  ctx: PluginContext,
  runtime: StandaloneUnpackRuntimeConfig,
): void {
  getFirmwareBackgroundCoordinator(ctx).configure(runtime);
}

export function registerFirmware(bb: BbPluginApi, ctx: PluginContext): void {
  const coordinator = getFirmwareBackgroundCoordinator(ctx);

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
        ? coordinator.enqueue(input)
        : materializeFromApi(input);
    },
    firmwareMaterializeCancel(input) {
      return coordinator.cancel(input);
    },
    firmwareFileHydrate: hydrateFirmwareFile,
  });
}
