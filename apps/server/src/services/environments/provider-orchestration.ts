import { withEnvironmentCleanupSlot } from "./cleanup-concurrency.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { foreignProviderOwnedPathRefusal } from "../threads/workspace-path-claims.js";
import {
  cancelPendingEnvironmentHook,
  runEnvironmentHook,
} from "./environment-hooks.js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  releaseFinishedEnvironmentPreparationOwners,
  environmentHasLiveThreads,
  environments,
  getEnvironment,
  getThread,
  findProjectEnvironmentByHostPath,
  getPreparingEnvironment,
  claimEnvironmentPath,
  bindEnvironmentPath,
  listProviderLifecycleEnvironments,
  reserveEnvironment,
  updatePreparingEnvironment,
  type DbConnection,
  type DbTransaction,
  type EnvironmentRow,
} from "@bb/db";
import {
  jsonValueSchema,
  type Environment,
  type EnvironmentMachineSelection,
  type Host,
  type JsonValue,
  type Project,
} from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import type {
  PluginEnvironmentProviderCreateResult,
  PluginEnvironmentProviderProgress,
} from "@get-bb/plugin-sdk/environment-provider";
import type { ThreadProvisioningDeps } from "../threads/thread-provisioning-environment.js";
import { toEnvironmentResponse } from "./environment-response.js";
import {
  getEnvironmentProvider,
  invokeEnvironmentProvider,
  listEnvironmentProviders,
  requestEnvironmentProvisioningRecheck,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import { applyLoggedEnvironmentLifecycleEvent } from "./lifecycle-outcome.js";

type Deps = ThreadProvisioningDeps;

interface ProviderOperationContext {
  thread: ThreadResponse;
  project: Project;
  host: Host;
  machine: EnvironmentMachineSelection;
  projectCheckout: { path: string } | null;
  gitRemote: string | null;
  inputs: JsonValue | null;
  suggestedBranchName: string;
  environment: Environment | null;
}

interface ActiveOperation {
  controller: AbortController;
  done: Promise<void>;
}

const resourceSchema = jsonValueSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value)) <= 16_384,
  "Resource exceeds 16 KiB",
);
const createResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("created"),
    path: z.string().min(1),
    ownsPath: z.boolean().default(false),
    mergeBaseBranch: z.string().min(1).optional(),
    resource: resourceSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    failure: z.enum(["terminal", "transient"]),
    message: z.string().min(1),
  }),
]);
const removeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("removed") }),
  z.object({ status: z.literal("failed"), message: z.string().min(1) }),
]);
const createOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const removeOperations = new WeakMap<object, Map<string, ActiveOperation>>();

function operations(
  registry: WeakMap<object, Map<string, ActiveOperation>>,
  db: DbConnection,
): Map<string, ActiveOperation> {
  let map = registry.get(db);
  if (map === undefined) {
    map = new Map();
    registry.set(db, map);
  }
  return map;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeEnvironment(
  deps: Pick<Deps, "db" | "hub">,
  environmentId: string,
  change: Partial<EnvironmentRow>,
): void {
  deps.db
    .update(environments)
    .set({ ...change, updatedAt: Date.now() })
    .where(eq(environments.id, environmentId))
    .run();
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
}

function mutateProvisioning(
  deps: Deps,
  provisioning: EnvironmentRow,
  phases: EnvironmentRow["provisioningPhase"][],
  change: (row: EnvironmentRow) => void,
): boolean {
  const row = getEnvironment(deps.db, provisioning.id);
  if (
    row === null ||
    row.provisioningAttempt !== provisioning.provisioningAttempt ||
    row.provisioningThreadId !== provisioning.provisioningThreadId ||
    !phases.includes(row.provisioningPhase)
  )
    return false;
  const before = JSON.stringify(row);
  change(row);
  if (JSON.stringify(row) === before) return false;
  const updated = updatePreparingEnvironment(deps.db, row);
  if (updated) deps.hub.notifyEnvironment(row.id, ["metadata-changed"]);
  return updated;
}

function provisioningReporter(
  deps: Deps,
  provisioning: EnvironmentRow,
): PluginEnvironmentProviderProgress {
  const update = (change: (row: EnvironmentRow) => void): void => {
    if (
      provisioning.provisioningThreadId !== null &&
      mutateProvisioning(deps, provisioning, ["creating"], change)
    )
      requestEnvironmentProvisioningRecheck(provisioning.provisioningThreadId);
  };
  return {
    step: (text) =>
      update((row) => {
        row.provisioningStep = text.slice(0, 200);
      }),
    log: (text) =>
      update((row) => {
        row.provisioningLog = (row.provisioningLog + text).slice(-16_384);
      }),
  };
}

function emptyReporter(): PluginEnvironmentProviderProgress {
  return { step: () => undefined, log: () => undefined };
}

function runTrackedOperation(args: {
  map: Map<string, ActiveOperation>;
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}): ActiveOperation {
  const existing = args.map.get(args.key);
  if (existing !== undefined) return existing;
  const controller = new AbortController();
  const operation: ActiveOperation = {
    controller,
    done: Promise.resolve(),
  };
  operation.done = args.run(controller.signal).finally(() => {
    if (args.map.get(args.key) === operation) args.map.delete(args.key);
  });
  args.map.set(args.key, operation);
  return operation;
}

const REMOVE_RETRY_MS = 60_000;
const TRANSIENT_RETRY_MS = 30_000;
const TRANSIENT_RETRY_LIMIT = 3;

async function invokeCreate(
  record: PluginEnvironmentProviderRecord,
  context: Parameters<PluginEnvironmentProviderRecord["provider"]["create"]>[0],
): Promise<PluginEnvironmentProviderCreateResult> {
  const invocation = await invokeEnvironmentProvider(
    record,
    "environment create",
    () => record.provider.create(context),
  );
  if (!invocation.ok) throw new Error(invocation.error);
  if (invocation.value === null)
    throw new Error("The environment provider became unavailable.");
  return createResultSchema.parse(invocation.value);
}

async function runCreate(
  deps: Deps,
  record: PluginEnvironmentProviderRecord,
  provisioning: EnvironmentRow,
  context: ProviderOperationContext,
  outerSignal: AbortSignal,
): Promise<void> {
  const signal = outerSignal;
  let changed = false;
  mutateProvisioning(deps, provisioning, ["creating"], (row) => {
    row.hostId = context.host.id;
  });
  try {
    const previous =
      context.environment === null
        ? null
        : getEnvironment(deps.db, context.environment.id);
    let result =
      provisioning.providerOwnsPath && provisioning.path !== null
        ? {
            status: "created" as const,
            path: provisioning.path,
            ownsPath: true,
            mergeBaseBranch: provisioning.mergeBaseBranch ?? undefined,
            resource: provisioning.resource ?? undefined,
          }
        : await invokeCreate(record, {
            thread: context.thread,
            project: context.project,
            host: context.host,
            projectCheckout: context.projectCheckout,
            gitRemote: context.gitRemote,
            inputs: context.inputs,
            suggestedBranchName: context.suggestedBranchName,
            pathKey:
              provisioning.environmentProviderInstanceKey ?? provisioning.id,
            attempt: provisioning.provisioningAttempt,
            rebuild: previous !== null,
            experimental_claimPath: async (value) => {
              const path = z
                .string()
                .min(1)
                .startsWith("/")
                .refine((path) => !path.includes("\0"))
                .parse(value);
              if (signal.aborted) return false;
              return claimEnvironmentPath(
                deps.db,
                provisioning,
                path.replace(/\/+$/u, "") || "/",
              );
            },
            previous:
              previous === null
                ? null
                : {
                    environment: toEnvironmentResponse(previous),
                    resource:
                      previous.teardownStatus === "removed"
                        ? null
                        : previous.resource,
                  },
            report: provisioningReporter(deps, provisioning),
            signal: signal,
          });
    if (result.status === "created") {
      try {
        const producedPath = result.path.replace(/\/+$/u, "") || "/";
        const { dataDir } = await ensureHostSessionReadyForWork(deps, {
          hostId: context.host.id,
        });
        deps.db.transaction(
          () => {
            const refusal = foreignProviderOwnedPathRefusal(deps.db, {
              dataDir,
              hostId: context.host.id,
              path: producedPath,
              projectId: context.project.id,
            });
            if (refusal !== null) throw new Error(refusal);
            const claimed = claimEnvironmentPath(
              deps.db,
              provisioning,
              producedPath,
              true,
            );
            if (!claimed)
              throw new Error(
                "Workspace path is already claimed by another provisioning.",
              );
            const existing = findProjectEnvironmentByHostPath(
              deps.db,
              context.project.id,
              context.host.id,
              producedPath,
            );
            if (
              existing !== null &&
              existing.environmentProviderId !== null &&
              (existing.environmentProviderId !== record.provider.id ||
                existing.environmentProviderPluginId !== record.pluginId)
            ) {
              throw new Error(
                `Workspace ${producedPath} is owned by the "${existing.environmentProviderId}" environment provider (plugin "${existing.environmentProviderPluginId ?? "unknown"}").`,
              );
            }
            provisioning = bindEnvironmentPath(
              deps.db,
              provisioning,
              producedPath,
            );
          },
          { behavior: "immediate" },
        );
        result = { ...result, path: producedPath };
      } catch (error) {
        mutateProvisioning(
          deps,
          provisioning,
          ["creating", "cancelled"],
          (row) => {
            row.provisioningPathRejected = true;
          },
        );
        throw error;
      }
      const produced = result;
      mutateProvisioning(
        deps,
        provisioning,
        ["creating", "cancelled"],
        (row) => {
          row.hostId = context.host.id;
          row.path = produced.path;
          row.providerOwnsPath = produced.ownsPath;
          row.mergeBaseBranch = produced.mergeBaseBranch ?? null;
          row.resource = produced.resource ?? null;
        },
      );
      signal.throwIfAborted();
    }
    changed = mutateProvisioning(deps, provisioning, ["creating"], (row) => {
      if (result.status === "created") {
        row.provisioningPhase = "ready";
      } else {
        row.provisioningPhase = "failed";
        row.provisioningFailure = result.failure;
        row.provisioningMessage = result.message;
        row.provisioningFailedAt = Date.now();
        if (result.failure === "transient")
          row.provisioningTransientFailures += 1;
      }
    });
  } catch (error) {
    const current = getEnvironment(deps.db, provisioning.id);
    if (
      signal.aborted &&
      current?.provisioningAttempt === provisioning.provisioningAttempt &&
      current.provisioningPhase === "cancelled"
    )
      return;
    changed = mutateProvisioning(deps, provisioning, ["creating"], (row) => {
      row.provisioningPhase = "failed";
      row.provisioningFailure = "terminal";
      row.provisioningMessage = `The "${record.provider.id}" environment provider (plugin "${record.pluginId}") failed: ${message(error)}`;
      row.provisioningFailedAt = Date.now();
    });
  } finally {
    if (changed) requestEnvironmentProvisioningRecheck(context.thread.id);
  }
}

function startCreate(
  deps: Deps,
  record: PluginEnvironmentProviderRecord,
  provisioning: EnvironmentRow,
  context: ProviderOperationContext,
): ActiveOperation {
  return runTrackedOperation({
    map: operations(createOperations, deps.db),
    key: provisioning.id,
    run: (signal) => runCreate(deps, record, provisioning, context, signal),
  });
}

export type ProviderEnvironmentCreationDecision =
  | { action: "wait"; reason: string; sendAt: number; log: string }
  | { action: "reject"; message: string; log: string }
  | {
      action: "ready";
      environment: EnvironmentRow;
      log: string;
    };

export function advanceProviderEnvironmentCreation(
  deps: Deps,
  record: PluginEnvironmentProviderRecord,
  context: ProviderOperationContext,
): ProviderEnvironmentCreationDecision {
  const now = Date.now();
  const policy = record.provider.policy;
  const previous =
    context.environment === null
      ? null
      : getEnvironment(deps.db, context.environment.id);
  let row = getPreparingEnvironment(deps.db, context.thread.id);
  if (
    (row !== null &&
      row.provisioningAttempt > 0 &&
      row.environmentProviderPluginId !== record.pluginId) ||
    (previous !== null &&
      previous.environmentProviderId !== null &&
      previous.environmentProviderPluginId !== record.pluginId)
  ) {
    return {
      action: "reject",
      message:
        "The environment provider belongs to a different plugin or has no recorded owner.",
      log: "",
    };
  }
  if (
    previous?.teardownStatus === "running" ||
    previous?.teardownStatus === "failed"
  )
    return {
      action: "wait",
      reason: "Removing the previous environment",
      sendAt: now + 1000,
      log: "",
    };
  const selected = { machine: context.machine, inputs: context.inputs };
  const changed =
    row !== null &&
    (row.environmentProviderId !== record.provider.id ||
      JSON.stringify(row.environmentProviderSelection) !==
        JSON.stringify(selected));
  const attached = row?.provisioningAttached === true;
  if (
    row !== null &&
    !attached &&
    ((changed && row.provisioningPhase !== "cancelled") ||
      row.provisioningPhase === "failed" ||
      (row.provisioningPhase === "cancelled" &&
        row.teardownStatus !== "removed"))
  ) {
    const failed = !changed && row.provisioningPhase === "failed";
    const retryable =
      row.provisioningFailure === "transient" &&
      row.provisioningTransientFailures <= TRANSIENT_RETRY_LIMIT;
    void cancelProviderEnvironmentCreation(deps, context.thread.id).catch(
      (error) =>
        deps.logger.warn(
          { threadId: context.thread.id, error: message(error) },
          "Environment cleanup will retry",
        ),
    );
    if (failed && !retryable)
      return {
        action: "reject",
        message: row.provisioningMessage ?? "Environment creation failed",
        log: row.provisioningLog,
      };
    return {
      action: "wait",
      reason: failed
        ? `${row.provisioningMessage}; cleaning up before retry`.slice(0, 200)
        : "Cancelling the previous environment provisioning",
      sendAt: now + 1000,
      log: "",
    };
  }
  const retryRow =
    row?.provisioningPhase === "cancelled" &&
    row.provisioningFailure === "transient" &&
    !changed &&
    row.provisioningTransientFailures <= TRANSIENT_RETRY_LIMIT
      ? row
      : null;
  const retryAt = (retryRow?.provisioningFailedAt ?? now) + TRANSIENT_RETRY_MS;
  if (retryRow !== null && now < retryAt)
    return {
      action: "wait",
      reason: `${retryRow.provisioningMessage}; retrying`.slice(0, 200),
      sendAt: retryAt,
      log: "",
    };
  const start =
    row === null ||
    row.provisioningAttempt === 0 ||
    changed ||
    row.provisioningPhase === "cancelled" ||
    attached;
  if (start) {
    const attempt = (row?.provisioningAttempt ?? 0) + 1;
    const pathKey =
      policy.pathKeys === "per-attempt" ||
      context.environment !== null ||
      attached
        ? `${context.thread.id}-${attempt}`
        : context.thread.id;
    row = reserveEnvironment(deps.db, {
      projectId: context.project.id,
      provisioningThreadId: context.thread.id,
      environmentProviderId: record.provider.id,
      environmentProviderPluginId: record.pluginId,
      provisioningAttempt: attempt,
      provisioningPhase: "creating",
      provisioningTransientFailures:
        retryRow?.provisioningTransientFailures ?? 0,
      environmentProviderInstanceKey: pathKey,
      hostId: context.host.id,
      provisioningStep: `${context.environment === null ? "Preparing" : "Restoring"} ${record.provider.displayName}…`,
      environmentProviderSelection: selected,
    });
    deps.hub.notifyEnvironment(row.id, ["environment-created"]);
    startCreate(deps, record, row, context);
  }
  if (row === null) throw new Error("Missing environment provisioning");
  const log = row.provisioningLog;
  if (log.length > 0)
    updatePreparingEnvironment(deps.db, { ...row, provisioningLog: "" });
  if (row.provisioningPhase === "ready" && row.path !== null)
    return { action: "ready", environment: row, log };
  if (row.provisioningPhase === "creating")
    startCreate(deps, record, row, context);
  return {
    action: "wait",
    reason: row.provisioningStep,
    sendAt: now + 1000,
    log,
  };
}

export function markProviderEnvironmentAttached(
  db: DbConnection | DbTransaction,
  threadId: string,
  environmentId: string,
): void {
  const row = getPreparingEnvironment(db, threadId);
  if (row === null || row.provisioningPhase !== "ready") return;
  if (row.id !== environmentId)
    throw new Error("Provisioning must attach its reserved environment");
  db.update(environments)
    .set({
      provisioningAttached: true,
      provisioningClaimPath: null,
      retireAt: null,
    })
    .where(eq(environments.id, row.id))
    .run();
}

export async function cancelProviderEnvironmentCreation(
  deps: Deps,
  threadId: string,
): Promise<void> {
  const row = getPreparingEnvironment(deps.db, threadId);
  if (
    row === null ||
    row.provisioningAttached ||
    row.teardownStatus === "removed"
  )
    return;
  if (row.provisioningPhase !== "cancelled") {
    updatePreparingEnvironment(deps.db, {
      ...row,
      provisioningPhase: "cancelled",
      retireAt: Date.now(),
    });
  }
  await sweepProviderEnvironment(deps, row.id);
  const current = getPreparingEnvironment(deps.db, threadId);
  if (
    current !== null &&
    !current.provisioningAttached &&
    current.teardownStatus !== "removed"
  )
    throw new Error(
      current.teardownMessage ?? "Environment cleanup could not complete",
    );
}

export function requestEnvironmentRemoval(
  deps: Deps,
  environmentId: string,
): boolean {
  const row = getEnvironment(deps.db, environmentId);
  if (row === null || environmentHasLiveThreads(deps.db, environmentId))
    return false;
  if (
    row.provisioningThreadId !== null &&
    !row.provisioningAttached &&
    row.provisioningPhase !== "cancelled"
  ) {
    const owner = getThread(deps.db, row.provisioningThreadId);
    if (
      owner !== null &&
      owner.status === "starting" &&
      owner.archivedAt === null &&
      owner.deletedAt === null
    )
      return false;
    updatePreparingEnvironment(deps.db, {
      ...row,
      provisioningPhase: "cancelled",
      retireAt: Date.now(),
    });
  }
  if (row.status === "destroyed") return true;
  if (row.environmentProviderId === null) {
    return applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId,
      event: { type: "destroy.recorded" },
    }).applied;
  }
  if (row.teardownStatus === null) {
    deps.db
      .update(environments)
      .set({
        status: "error",
        retireAt: Date.now(),
        teardownStatus: "running",
      })
      .where(eq(environments.id, environmentId))
      .run();
    deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
  }
  return true;
}

async function runRemove(
  deps: Deps,
  environmentId: string,
  attempt: number,
  resumeOnly: boolean,
  signal: AbortSignal,
): Promise<void> {
  const row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus !== "running"
  )
    return;
  const record = getEnvironmentProvider(row.environmentProviderId);
  if (
    record === undefined ||
    record.pluginId !== row.environmentProviderPluginId
  )
    throw new Error(
      `Environment provider "${row.environmentProviderId}" is unavailable or belongs to another plugin`,
    );
  try {
    if (row.providerOwnsPath && row.hostId !== null && row.path !== null) {
      await runEnvironmentHook(deps, {
        id: `environment:${environmentId}:${row.environmentProviderInstanceKey}:teardown`,
        hostId: row.hostId,
        path: row.path,
        kind: "teardown",
        resumeOnly,
        report: {
          step: () => undefined,
          log: (text) =>
            deps.logger.warn(
              { environmentId, text },
              "Environment teardown hook",
            ),
        },
        signal,
      });
    }
    const invocation = await invokeEnvironmentProvider(
      record,
      "environment remove",
      () =>
        record.provider.remove({
          environment:
            row.provisioningPhase !== null && !row.provisioningAttached
              ? null
              : toEnvironmentResponse(row),
          hostId: row.hostId,
          path: row.path,
          pathKey: row.environmentProviderInstanceKey ?? row.id,
          resource: row.resource,
          attempt,
          report: emptyReporter(),
          signal,
        }),
    );
    if (!invocation.ok) throw new Error(invocation.error);
    if (invocation.value === null)
      throw new Error("The environment provider became unavailable.");
    const result = removeResultSchema.parse(invocation.value);
    if (result.status === "failed") {
      writeEnvironment(deps, environmentId, {
        teardownStatus: "failed",
        teardownMessage: result.message,
        retireAt: Date.now() + REMOVE_RETRY_MS,
      });
      return;
    }
    writeEnvironment(deps, environmentId, {
      teardownStatus: "removed",
      teardownMessage: null,
      provisioningClaimPath: null,
      resource: null,
      retireAt: null,
    });
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId,
      event: { type: "destroy.recorded" },
    });
  } catch (error) {
    writeEnvironment(deps, environmentId, {
      teardownStatus: "failed",
      teardownMessage: message(error),
      retireAt: Date.now() + REMOVE_RETRY_MS,
    });
  }
}

export async function sweepProviderEnvironment(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  const operation = runTrackedOperation({
    map: operations(removeOperations, deps.db),
    key: environmentId,
    run: async (signal) => {
      const row = getEnvironment(deps.db, environmentId);
      if (row === null) return;
      if (row.provisioningPhase === "cancelled") {
        const create = operations(createOperations, deps.db).get(environmentId);
        if (create !== undefined) {
          create.controller.abort();
          await create.done;
        }
        const current =
          row.provisioningThreadId === null
            ? null
            : getPreparingEnvironment(deps.db, row.provisioningThreadId);
        if (current !== null && current.id !== row.id) {
          await sweepProviderEnvironment(deps, current.id);
          return;
        }
      }
      await withEnvironmentCleanupSlot(deps.db, row.hostId, () =>
        sweepProviderEnvironmentInSlot(deps, environmentId, signal),
      );
    },
  });
  await operation.done;
}

async function sweepProviderEnvironmentInSlot(
  deps: Deps,
  environmentId: string,
  signal: AbortSignal,
): Promise<void> {
  let row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus === "removed"
  )
    return;
  const cancelled =
    row.provisioningPhase === "cancelled" && !row.provisioningAttached;
  const shared = environmentHasLiveThreads(deps.db, environmentId);
  if (cancelled && (row.provisioningPathRejected || shared)) {
    deps.db
      .update(environments)
      .set({
        provisioningClaimPath: null,
        ...(shared
          ? { provisioningAttached: true, retireAt: null }
          : {
              status: "destroyed",
              teardownStatus: "removed",
              path: null,
              resource: null,
              retireAt: null,
            }),
      })
      .where(eq(environments.id, environmentId))
      .run();
    deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
    return;
  }
  if (!cancelled && row.provisioningPhase !== null && !row.provisioningAttached)
    return;
  const record = getEnvironmentProvider(row.environmentProviderId);
  if (record === undefined) return;
  const now = Date.now();
  if (shared) {
    if (row.retireAt !== null && row.teardownStatus === null)
      writeEnvironment(deps, environmentId, { retireAt: null });
    return;
  }
  if (record.pluginId !== row.environmentProviderPluginId) {
    const teardownMessage =
      "The environment provider belongs to a different plugin or has no recorded owner. Automatic removal is blocked.";
    if (row.teardownMessage !== teardownMessage)
      writeEnvironment(deps, environmentId, {
        teardownStatus: "failed",
        teardownMessage,
      });
    return;
  }
  if (row.retireAt === null) {
    if (
      !cancelled &&
      record.provider.policy.retireGraceMs === null &&
      row.status !== "destroyed"
    )
      return;
    const retireAt =
      row.status === "destroyed" || cancelled
        ? now
        : now + (record.provider.policy.retireGraceMs ?? 0);
    writeEnvironment(deps, environmentId, { retireAt });
    row = { ...row, retireAt };
  }
  if (row.retireAt !== null && row.retireAt > now) return;
  if (!requestEnvironmentRemoval(deps, environmentId)) return;
  if (cancelled && row.providerOwnsPath && row.path !== null) {
    await cancelPendingEnvironmentHook(deps, {
      id: `environment:${row.id}:${row.environmentProviderInstanceKey}:setup`,
      hostId: row.hostId,
    });
  }
  row = getEnvironment(deps.db, environmentId);
  if (row === null || row.teardownStatus === "removed") return;
  if (
    row.teardownStatus === "failed" &&
    row.retireAt !== null &&
    row.retireAt > now
  )
    return;
  const attempt =
    row.teardownStatus === "running" && row.teardownAttempt > 0
      ? row.teardownAttempt
      : row.teardownAttempt + 1;
  writeEnvironment(deps, environmentId, {
    status: row.status === "destroyed" ? "destroyed" : "error",
    teardownStatus: "running",
    teardownAttempt: attempt,
    teardownMessage: null,
  });
  await runRemove(
    deps,
    environmentId,
    attempt,
    row.teardownAttempt > 0,
    signal,
  );
}

export async function sweepProviderLifecycles(deps: Deps): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const record of listEnvironmentProviders()) {
    for (const row of listProviderLifecycleEnvironments(
      deps.db,
      record.provider.id,
    )) {
      pending.push(
        sweepProviderEnvironment(deps, row.id).catch((error) => {
          deps.logger.warn(
            { environmentId: row.id, error: message(error) },
            "Environment removal will retry",
          );
        }),
      );
    }
  }
  await Promise.all(pending);
  releaseFinishedEnvironmentPreparationOwners(deps.db);
}

export function providerEnvironmentHasPendingWork(
  db: DbConnection | DbTransaction,
  threadId: string,
): boolean {
  const row = getPreparingEnvironment(db, threadId);
  if (row === null) return false;
  if (row.provisioningPhase === "cancelled")
    return !row.provisioningAttached && row.teardownStatus !== "removed";
  return (
    !row.provisioningAttached &&
    (row.provisioningPhase === "creating" ||
      row.provisioningPhase === "ready" ||
      row.provisioningPhase === "failed")
  );
}

export function refreshProviderRetirement(
  deps: {
    db: DbConnection | DbTransaction;
    hub: Pick<Deps["hub"], "notifyEnvironment">;
  },
  environmentId: string,
): void {
  const row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus !== null
  )
    return;
  const provider = getEnvironmentProvider(row.environmentProviderId);
  if (provider === undefined) return;
  const grace = provider.provider.policy.retireGraceMs;
  const retireAt =
    grace === null || environmentHasLiveThreads(deps.db, environmentId)
      ? null
      : (row.retireAt ?? Date.now() + grace);
  if (row.retireAt === retireAt) return;
  deps.db
    .update(environments)
    .set({ retireAt })
    .where(eq(environments.id, environmentId))
    .run();
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
}
