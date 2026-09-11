import { findHostDataDir } from "../lib/entity-lookup.js";
import { updateThread } from "@bb/db";
import {
  assertEnvironmentPathAvailable,
  withEnvironmentPathAdmission,
} from "./path-admission.js";
import { saveThreadProvisionContext } from "../threads/thread-startup-store.js";
import {
  refreshAttachedEnvironmentBranch,
  resolveProviderOperationContext,
} from "../threads/thread-environment-placement.js";
import { withEnvironmentCleanupSlot } from "./cleanup-concurrency.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { foreignProviderOwnedPathRefusal } from "../threads/workspace-path-claims.js";
import {
  cancelPendingEnvironmentHook,
  runEnvironmentHook,
  ENVIRONMENT_HOOK_TIMEOUT_MS,
} from "./environment-hooks.js";
import { eq, and, isNull, or, sql } from "drizzle-orm";
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
  updatePreparingEnvironment,
  type DbConnection,
  type DbTransaction,
  type EnvironmentRow,
  events,
  type DbNotifier,
  type DbQueryConnection,
  threads,
} from "@bb/db";
import {
  jsonValueSchema,
  type Environment,
  type EnvironmentMachineSelection,
  type Host,
  type JsonValue,
  type Project,
  type ProvisioningTranscriptEntry,
  type SystemThreadProvisioningStatus,
  type ThreadStatus,
  threadScope,
} from "@bb/domain";
import { type ThreadResponse } from "@bb/server-contract";
import {
  type PluginEnvironmentProviderCreateResult,
  type PluginEnvironmentProviderProgress,
} from "@get-bb/plugin-sdk/environment-provider";
import {
  type ThreadProvisioningDeps,
  ensureWorkspaceReadyEventInTransaction,
} from "../threads/thread-provisioning-environment.js";
import { toEnvironmentResponse } from "./environment-response.js";
import {
  getEnvironmentProvider,
  invokeEnvironmentProvider,
  listEnvironmentProviders,
  requestEnvironmentProvisioningRecheck,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import {
  applyLoggedEnvironmentLifecycleEvent,
  applyLoggedEnvironmentLifecycleEventInTransaction,
} from "./lifecycle-outcome.js";
import { buildEnvironmentProvisionCommand } from "../threads/thread-create-helpers.js";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import { type AppDeps } from "../../types.js";
import {
  appendThreadProvisioningEvent,
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import { type EnvironmentProvisionRequest } from "./environment-provision-request.js";
import {
  createLiveHostCommandExecution,
  expectedLiveHostCommandErrorLogFields,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../hosts/live-command.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "../threads/lifecycle-outcome.js";
import {
  clearThreadProvisionSchedule,
  getThreadProvisionContext,
} from "../threads/thread-startup-store.js";
import { advanceThreadProvisioning } from "../threads/thread-provisioning.js";
import {
  finalizeStoppedThreadInTransaction,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";

type Deps = ThreadProvisioningDeps;

export interface ProviderOperationContext {
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
  kind: "create" | "attach" | "remove";
  controller: AbortController;
  done: Promise<void>;
  cancellation: Promise<void> | null;
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
    message: z.string().min(1),
  }),
]);
const removeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("removed") }),
  z.object({ status: z.literal("failed"), message: z.string().min(1) }),
]);
const environmentOperations = new WeakMap<
  object,
  Map<string, ActiveOperation>
>();

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
  phases: EnvironmentRow["status"][],
  change: (row: EnvironmentRow) => void,
): boolean {
  const row = getEnvironment(deps.db, provisioning.id);
  if (
    row === null ||
    row.attempt !== provisioning.attempt ||
    row.ownerThreadId !== provisioning.ownerThreadId ||
    !phases.includes(row.status)
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
  const report = (
    change: (row: EnvironmentRow) => void,
    step: string | null,
  ) => {
    const before = getEnvironment(deps.db, provisioning.id);
    if (!mutateProvisioning(deps, provisioning, ["creating"], change)) return;
    const owner = provisioning.ownerThreadId;
    if (owner === null) return;
    const context = getThreadProvisionContext(deps.db, owner);
    if (context !== null)
      deps.db.transaction((tx) => {
        const row = getEnvironment(tx, provisioning.id);
        if (row === null) return;
        const entries: ProvisioningTranscriptEntry[] = [];
        const key = (text: string) => `provider-step-${row.attempt}-${text}`;
        if (step !== null) {
          if (before?.statusMessage)
            entries.push({
              type: "step",
              key: key(before.statusMessage),
              text: before.statusMessage,
              status: "completed",
            });
          entries.push({
            type: "step",
            key: key(step),
            text: step,
            status: "started",
          });
        }
        if (row.pendingLog !== "")
          entries.push({
            type: "output",
            key: `provider-output-${row.attempt}-${Date.now()}`,
            text: row.pendingLog,
          });
        if (entries.length > 0)
          appendThreadProvisioningEventInTransaction(tx, {
            threadId: owner,
            environmentId: row.id,
            provisioningId: context.state.provisioningId,
            status: "active",
            entries,
          });
        tx.update(environments)
          .set({ pendingLog: "" })
          .where(eq(environments.id, row.id))
          .run();
        deps.hub.notifyThread(owner, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
      });
    requestEnvironmentProvisioningRecheck(owner);
  };
  return {
    step: (text) =>
      report(
        (row) => {
          row.statusMessage = text.slice(0, 200);
        },
        text.slice(0, 200),
      ),
    log: (text) =>
      report((row) => {
        row.pendingLog = (row.pendingLog + text).slice(-16_384);
      }, null),
  };
}

function emptyReporter(): PluginEnvironmentProviderProgress {
  return { step: () => undefined, log: () => undefined };
}

function runTrackedOperation(args: {
  kind: ActiveOperation["kind"];
  map: Map<string, ActiveOperation>;
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}): ActiveOperation {
  const existing = args.map.get(args.key);
  if (existing !== undefined) return existing;
  const controller = new AbortController();
  const operation: ActiveOperation = {
    kind: args.kind,
    controller,
    done: Promise.resolve(),
    cancellation: null,
  };
  operation.done = args.run(controller.signal).finally(async () => {
    await operation.cancellation;
    if (args.map.get(args.key) === operation) args.map.delete(args.key);
  });
  args.map.set(args.key, operation);
  return operation;
}

const REMOVE_RETRY_MS = 60_000;

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
            attempt: provisioning.attempt,
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
          ["creating", "ready", "error"],
          (row) => {
            row.teardownStatus = "removed";
            row.claimPath = null;
            row.path = null;
            row.resource = null;
          },
        );
        throw error;
      }
      const produced = result;
      mutateProvisioning(
        deps,
        provisioning,
        ["creating", "ready", "error"],
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
    changed = mutateProvisioning(
      deps,
      provisioning,
      ["creating", "ready"],
      (row) => {
        if (result.status === "created") {
          row.status = row.status === "ready" ? "ready" : "provisioning";
        } else {
          row.status = "error";
          row.statusMessage = result.message;
        }
      },
    );
  } catch (error) {
    const current = getEnvironment(deps.db, provisioning.id);
    if (
      signal.aborted &&
      current?.attempt === provisioning.attempt &&
      current.teardownStatus === "running"
    )
      return;
    changed = mutateProvisioning(deps, provisioning, ["creating"], (row) => {
      row.status = "error";
      row.statusMessage = `The "${record.provider.id}" environment provider (plugin "${record.pluginId}") failed: ${message(error)}`;
    });
  } finally {
    if (
      changed ||
      getPreparingEnvironment(deps.db, context.thread.id)?.status === "ready"
    ) {
      const row = getPreparingEnvironment(deps.db, context.thread.id);
      const startup = getThreadProvisionContext(deps.db, context.thread.id);
      if (
        row !== null &&
        startup !== null &&
        (row.status === "ready" || row.status === "provisioning")
      ) {
        appendThreadProvisioningEvent(deps, {
          threadId: context.thread.id,
          environmentId: row.id,
          provisioningId: startup.state.provisioningId,
          status: "active",
          entries: [
            {
              type: "step",
              key: `provider-step-${row.attempt}-${row.statusMessage}`,
              text: row.statusMessage ?? "Creating environment",
              status: "completed",
            },
          ],
        });
        deps.hub.notifyThread(context.thread.id, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
      }
      requestEnvironmentProvisioningRecheck(context.thread.id);
    }
  }
}

export function markProviderEnvironmentAttached(
  db: DbConnection | DbTransaction,
  threadId: string,
  environmentId: string,
): void {
  const row = getPreparingEnvironment(db, threadId);
  if (row === null || (row.status !== "provisioning" && row.status !== "ready"))
    return;
  if (row.id !== environmentId)
    throw new Error("Provisioning must attach its reserved environment");
  db.update(environments)
    .set({
      ownerThreadId: null,
      claimPath: null,
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
  if (row === null) return;
  if (row.teardownStatus === "removed") {
    if (row.status !== "destroyed")
      writeEnvironment(deps, row.id, { status: "destroyed" });
    return;
  }
  if (row.teardownStatus === null) {
    updatePreparingEnvironment(deps.db, {
      ...row,
      teardownStatus: "running",
      retireAt: Date.now(),
    });
  }
  await sweepProviderEnvironment(deps, row.id);
  let current = getPreparingEnvironment(deps.db, threadId);
  if (current !== null && current.id !== row.id) {
    await sweepProviderEnvironment(deps, current.id);
    current = getPreparingEnvironment(deps.db, threadId);
  }
  if (current !== null && current.teardownStatus !== "removed")
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
  if (row.ownerThreadId !== null && row.teardownStatus === null) {
    const owner = getThread(deps.db, row.ownerThreadId);
    if (
      owner !== null &&
      owner.status === "starting" &&
      owner.archivedAt === null &&
      owner.deletedAt === null
    )
      return false;
    updatePreparingEnvironment(deps.db, {
      ...row,
      teardownStatus: "running",
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
            row.ownerThreadId !== null ? null : toEnvironmentResponse(row),
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
      claimPath: null,
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

async function removeEnvironment(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  const map = operations(environmentOperations, deps.db);
  const active = map.get(environmentId);
  if (active !== undefined) {
    const row = getEnvironment(deps.db, environmentId);
    if (active.kind === "create" && row?.teardownStatus === "running")
      active.controller.abort();
    await active.done;
    if (active.kind === "remove") return;
  }
  const operation = runTrackedOperation({
    kind: "remove",
    map,
    key: environmentId,
    run: (signal) => {
      const row = getEnvironment(deps.db, environmentId);
      return row === null
        ? Promise.resolve()
        : withEnvironmentCleanupSlot(deps.db, row.hostId, () =>
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
  const cancelled = row.ownerThreadId !== null && row.teardownStatus !== null;
  const shared = environmentHasLiveThreads(deps.db, environmentId);
  if (cancelled && shared) {
    writeEnvironment(deps, environmentId, {
      ownerThreadId: null,
      claimPath: null,
      retireAt: null,
      teardownStatus: null,
    });
    return;
  }
  if (!cancelled && row.ownerThreadId !== null) return;
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
  return row.teardownStatus !== "removed";
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

type EnvironmentProvisionCommand =
  HostDaemonCommandForType<"environment.attach">;
type EnvironmentProvisionCommandResultReport =
  CommandResultReportForType<"environment.attach">;
type EnvironmentProvisionCancelCommand =
  HostDaemonCommandForType<"environment.attach.cancel">;
type EnvironmentProvisionCancelCommandResultReport =
  CommandResultReportForType<"environment.attach.cancel">;

interface EnvironmentProvisionReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionWriteDeps extends EnvironmentProvisionReadDeps {
  db: DbConnection | DbTransaction;
  hub: DbNotifier;
}

interface EnvironmentProvisionTransactionDeps extends EnvironmentProvisionWriteDeps {
  db: DbTransaction;
  logger: AppDeps["logger"];
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface AdvanceEnvironmentProvisioningArgs {
  removal?: boolean;
  threadId?: string;
  creation?: {
    record: PluginEnvironmentProviderRecord;
    context: ProviderOperationContext;
  };
  environmentId: string | null | undefined;
  request?: EnvironmentProvisionRequest | null;
}

interface SettleEnvironmentProvisionCommandResultArgs {
  command: EnvironmentProvisionCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCommandResultReport;
}

interface SettleEnvironmentProvisionCancelCommandResultArgs {
  command: EnvironmentProvisionCancelCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCancelCommandResultReport;
}

interface FailEnvironmentProvisioningDurablyArgs {
  environmentId: string;
  failureEntry: ProvisioningTranscriptEntry;
  failureReason: string;
  provisioningId: string;
}

interface StartTrackedEnvironmentProvisionCommandArgs {
  environment: EnvironmentRow;
  request: EnvironmentProvisionRequest;
}

interface SettleEnvironmentProvisionOutcomeArgs extends SettleEnvironmentProvisionCommandResultArgs {
  headSha: string | null;
  initiatorStreamed: boolean;
  mergeBaseBranch: string | null;
}

interface InterruptUnrecoverableEnvironmentProvisioningArgs {
  environmentId: string;
  reason: string;
}

interface LiveEnvironmentThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
}

interface StopRequestedEnvironmentProvisionThread {
  id: string;
  status: ThreadStatus;
}

interface AppendThreadProvisioningEventToEnvironmentThreadsArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  fallbackProvisioningId: string;
  status: SystemThreadProvisioningStatus;
  threads?: LiveEnvironmentThread[];
}

function listLiveEnvironmentThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): LiveEnvironmentThread[] {
  return deps.db
    .select({
      environmentId: threads.environmentId,
      id: threads.id,
      status: threads.status,
    })
    .from(threads)
    .where(
      and(eq(threads.environmentId, environmentId), isNull(threads.deletedAt)),
    )
    .all();
}

function listStopRequestedEnvironmentProvisionThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): StopRequestedEnvironmentProvisionThread[] {
  return deps.db
    .select({
      id: threads.id,
      status: threads.status,
    })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        eq(threads.status, "stopping"),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .all();
}

function resolveLiveThreadProvisioningId(
  deps: EnvironmentProvisionReadDeps,
  thread: LiveEnvironmentThread,
  fallbackProvisioningId: string,
): string {
  const context = getThreadProvisionContext(deps.db, thread.id);
  if (context?.state.environmentId === thread.environmentId) {
    return context.state.provisioningId;
  }
  return fallbackProvisioningId;
}

function appendThreadProvisioningEventToEnvironmentThreadsInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: AppendThreadProvisioningEventToEnvironmentThreadsArgs,
): void {
  const liveThreads =
    args.threads ?? listLiveEnvironmentThreads(deps, args.environmentId);

  for (const thread of liveThreads) {
    const provisioningId = resolveLiveThreadProvisioningId(
      deps,
      thread,
      args.fallbackProvisioningId,
    );
    appendThreadProvisioningEventInTransaction(deps.db, {
      entries: args.entries,
      environmentId: args.environmentId,
      provisioningId,
      status: args.status,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
}

function hasActiveThreadProvisioningContext(
  deps: EnvironmentProvisionReadDeps,
  thread: LiveEnvironmentThread,
): boolean {
  const context = getThreadProvisionContext(deps.db, thread.id);
  return context?.state.environmentId === thread.environmentId;
}

function shouldPreserveThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  args: { provisioningId: string; thread: LiveEnvironmentThread },
): boolean {
  if (args.thread.status === "stopping") return true;
  return (
    deps.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.thread.id),
          eq(events.type, "system/thread-provisioning"),
          sql`json_extract(${events.data}, '$.status') = 'cancelled'`,
          or(
            sql`json_extract(${events.data}, '$.provisioningId') = ${args.provisioningId}`,
            sql`${events.sequence} = (select max(last.sequence) from events last where last.thread_id = ${args.thread.id} and last.environment_id = ${args.thread.environmentId} and last.type = 'system/thread-provisioning')`,
          ),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function recordEnvironmentProvisioningFailureInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: FailEnvironmentProvisioningDurablyArgs,
): boolean {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return false;
  }
  const liveThreads = listLiveEnvironmentThreads(deps, environment.id);
  const failureThreads = liveThreads.filter(
    (thread) =>
      !shouldPreserveThreadProvisionCancellationOutcome(deps, {
        provisioningId: args.provisioningId,
        thread,
      }),
  );
  if (failureThreads.length === 0 && liveThreads.length > 0) {
    if (environment.status === "destroyed") return false;
    const outcome = applyLoggedEnvironmentLifecycleEventInTransaction(deps, {
      environmentId: environment.id,
      event: { type: "provision.cancelled" },
    });
    if (outcome.applied)
      deps.hub.notifyEnvironment(environment.id, outcome.changes);
    return true;
  }

  const failureOutcome = applyLoggedEnvironmentLifecycleEventInTransaction(
    deps,
    {
      environmentId: environment.id,
      event: { type: "provision.failed" },
    },
  );
  if (failureOutcome.applied) {
    deps.hub.notifyEnvironment(environment.id, failureOutcome.changes);
  }

  appendThreadProvisioningEventToEnvironmentThreadsInTransaction(deps, {
    environmentId: environment.id,
    fallbackProvisioningId: args.provisioningId,
    status: "failed",
    threads: failureThreads,
    entries: [args.failureEntry],
  });

  for (const thread of failureThreads) {
    clearThreadProvisionSchedule(thread.id);
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId: environment.id,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.failureReason,
      scope: threadScope(),
    });
    const outcome = applyLoggedThreadLifecycleEventInTransaction(deps, {
      event: { type: "run.failed" },
      threadId: thread.id,
    });
    if (outcome.applied) {
      deps.hub.notifyThread(thread.id, ["status-changed"]);
    }
  }

  return true;
}

export function settleEnvironmentProvisionCommandResult(
  args: SettleEnvironmentProvisionCommandResultArgs,
): CommandResultSideEffectsResult {
  return settleEnvironmentProvisionOutcome({
    ...args,
    headSha: null,
    initiatorStreamed: true,
    mergeBaseBranch:
      getEnvironment(args.deps.db, args.command.environmentId)
        ?.mergeBaseBranch ?? null,
  });
}

function settleEnvironmentProvisionOutcome(
  args: SettleEnvironmentProvisionOutcomeArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const initiator = args.command.initiator;
  if (!initiator && !args.report.ok) {
    const outcome = applyLoggedEnvironmentLifecycleEventInTransaction(
      args.deps,
      {
        environmentId: args.command.environmentId,
        event: { type: "provision.failed" },
      },
    );
    if (outcome.applied) {
      args.deps.hub.notifyEnvironment(
        args.command.environmentId,
        outcome.changes,
      );
    }
    return emptyCommandResultSideEffects();
  }

  const boundThreads = args.deps.db
    .select()
    .from(threads)
    .where(eq(threads.environmentId, args.command.environmentId))
    .all();

  if (args.report.ok) {
    recordProvisionedEnvironmentWorkspace(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        path: args.report.result.path,
        isGitRepo: args.report.result.isGitRepo,
        isWorktree: args.report.result.isWorktree,
        branchName: args.report.result.branchName,
        defaultBranch: args.report.result.defaultBranch,
        ...(args.mergeBaseBranch === null
          ? {}
          : { baseBranch: null, mergeBaseBranch: args.mergeBaseBranch }),
      },
    );
    const provisionedOutcome =
      applyLoggedEnvironmentLifecycleEventInTransaction(args.deps, {
        environmentId: args.command.environmentId,
        event: { type: "provision.succeeded" },
      });
    if (provisionedOutcome.applied) {
      args.deps.hub.notifyEnvironment(
        args.command.environmentId,
        provisionedOutcome.changes,
      );
    }
    args.deps.hub.notifyEnvironment(args.command.environmentId, [
      "work-status-changed",
    ]);
    if (!initiator) {
      return emptyCommandResultSideEffects();
    }
    const environmentProvisioningId = initiator.provisioningId;

    const cwdBranchEntries = buildCwdBranchEntries({
      path: args.report.result.path,
      branchName: args.report.result.branchName,
      headSha: args.headSha,
    });

    for (const thread of boundThreads) {
      if (thread.deletedAt !== null) {
        finalizeStoppedThreadInTransaction(args.deps, {
          threadId: thread.id,
        });
        continue;
      }
      if (
        thread.archivedAt !== null ||
        shouldPreserveThreadProvisionCancellationOutcome(args.deps, {
          provisioningId: environmentProvisioningId,
          thread,
        })
      ) {
        continue;
      }

      const entries =
        thread.id === initiator.threadId && args.initiatorStreamed
          ? []
          : cwdBranchEntries;

      if (!hasActiveThreadProvisioningContext(args.deps, thread)) {
        appendThreadProvisioningEventInTransaction(args.deps.db, {
          threadId: thread.id,
          environmentId: args.command.environmentId,
          provisioningId: environmentProvisioningId,
          status: thread.status === "starting" ? "active" : "completed",
          entries,
        });
        args.deps.hub.notifyThread(thread.id, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
        continue;
      }

      ensureWorkspaceReadyEventInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      postCommitActions.push({
        run: (deps) => advanceThreadProvisioning(deps, { threadId: thread.id }),
      });
    }

    return { postCommitActions };
  }

  if (!initiator) {
    return emptyCommandResultSideEffects();
  }
  const environmentProvisioningId = initiator.provisioningId;
  recordEnvironmentProvisioningFailureInTransaction(args.deps, {
    environmentId: args.command.environmentId,
    failureReason: args.report.errorMessage,
    provisioningId: environmentProvisioningId,
    failureEntry: {
      type: "step",
      key: "workspace-failed",
      text: "Workspace setup failed",
      status: "failed",
      startedAt: args.execution.createdAt,
      metadata: { durationMs: Date.now() - args.execution.createdAt },
    },
  });
  return { postCommitActions };
}

export function settleEnvironmentProvisionCancelCommandResult(
  args: SettleEnvironmentProvisionCancelCommandResultArgs,
): CommandResultSideEffectsResult {
  const stoppedThreads = listStopRequestedEnvironmentProvisionThreads(
    args.deps,
    args.command.environmentId,
  );
  if (!args.report.ok) {
    const environment = getEnvironment(
      args.deps.db,
      args.command.environmentId,
    );
    args.deps.logger.warn(
      {
        activeProvisionState:
          environment?.status === "provisioning" ? "provisioning" : null,
        executionId: args.execution.id,
        environmentId: args.command.environmentId,
        errorCode: args.report.errorCode,
        errorMessage: args.report.errorMessage,
        stoppedThreadCount: stoppedThreads.length,
        stoppedThreadIds: stoppedThreads.map((thread) => thread.id),
      },
      "Environment provision cancel command failed",
    );

    if (!environment || stoppedThreads.length === 0) {
      return emptyCommandResultSideEffects();
    }

    return {
      postCommitActions: [
        {
          run: (deps) => {
            for (const thread of stoppedThreads) {
              requestThreadStopForCurrentState(
                deps,
                {
                  environmentId: args.command.environmentId,
                  id: thread.id,
                  status: thread.status,
                },
                {
                  hostId: environment.hostId,
                  id: environment.id,
                },
              );
            }
          },
        },
      ],
    };
  }

  const postCommitActions: CommandResultPostCommitAction[] = [];
  const cancelledOutcome = applyLoggedEnvironmentLifecycleEventInTransaction(
    args.deps,
    {
      environmentId: args.command.environmentId,
      event: { type: "provision.cancelled" },
    },
  );
  if (cancelledOutcome.applied) {
    args.deps.hub.notifyEnvironment(
      args.command.environmentId,
      cancelledOutcome.changes,
    );
  }

  for (const thread of stoppedThreads) {
    finalizeStoppedThreadInTransaction(args.deps, {
      threadId: thread.id,
    });
  }

  return { postCommitActions };
}

function interruptUnrecoverableEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: InterruptUnrecoverableEnvironmentProvisioningArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status !== "provisioning") {
    return;
  }

  const now = Date.now();
  deps.db.transaction(
    (tx) => {
      recordEnvironmentProvisioningFailureInTransaction(
        {
          ...deps,
          db: tx,
        },
        {
          environmentId: environment.id,
          failureReason: args.reason,
          provisioningId: `env-${environment.id}-interrupted`,
          failureEntry: {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup interrupted",
            status: "failed",
            startedAt: now,
            metadata: { durationMs: 0 },
          },
        },
      );
    },
    { behavior: "immediate" },
  );
}

async function runEnvironmentProvisionCommand(
  deps: CommandResultSideEffectsDeps,
  args: StartTrackedEnvironmentProvisionCommandArgs,
): Promise<void> {
  const execution = createLiveHostCommandExecution(args.environment.hostId);
  await runLiveHostCommand(deps, {
    command: args.request.command,
    execution,
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  }).catch((error) => {
    const expectedErrorFields =
      error instanceof Error
        ? expectedLiveHostCommandErrorLogFields(error)
        : null;
    if (expectedErrorFields !== null) {
      deps.logger.debug(
        {
          commandType: args.request.command.type,
          environmentId: args.environment.id,
          ...expectedErrorFields,
          executionId: execution.id,
          hostId: args.environment.hostId,
          initiatorThreadId: args.request.command.initiator?.threadId ?? null,
          provisioningId:
            args.request.command.initiator?.provisioningId ?? null,
        },
        "Live environment provisioning cancelled",
      );
      return;
    }
    deps.logger.warn(
      {
        commandType: args.request.command.type,
        err: error,
        environmentId: args.environment.id,
        executionId: execution.id,
        hostId: args.environment.hostId,
      },
      "Live environment provision command failed",
    );
  });
}

function recoverEnvironmentProvisionRequest(
  deps: CommandResultSideEffectsDeps,
  environment: EnvironmentRow,
): EnvironmentProvisionRequest | null {
  if (environment.path === null) return null;
  const owners = deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environment.id),
        eq(threads.status, "starting"),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .all();
  for (const owner of owners) {
    const context = getThreadProvisionContext(deps.db, owner.id);
    if (context?.state.environmentId !== environment.id) continue;
    return {
      command: buildEnvironmentProvisionCommand({
        environmentId: environment.id,
        hostId: environment.hostId,
        initiator: {
          threadId: owner.id,
          provisioningId: context.state.provisioningId,
        },
        path: environment.path,
        setupScriptTimeoutMs: environment.providerOwnsPath
          ? ENVIRONMENT_HOOK_TIMEOUT_MS
          : null,
      }),
    };
  }
  return null;
}

export async function advanceEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: AdvanceEnvironmentProvisioningArgs,
): Promise<void> {
  if (!args.environmentId) return;
  let environment = getEnvironment(deps.db, args.environmentId);
  if (environment === null) return;
  const map = operations(environmentOperations, deps.db);
  if (
    args.threadId !== undefined &&
    environment.ownerThreadId !== null &&
    environment.ownerThreadId !== args.threadId
  )
    assertEnvironmentPathAvailable(deps, {
      ...environment,
      threadId: args.threadId,
    });
  if (
    args.removal ||
    (environment.teardownStatus !== null &&
      environment.teardownStatus !== "removed")
  ) {
    await removeEnvironment(deps, environment.id);
    return;
  }
  if (
    environment.status === "provisioning" &&
    listStopRequestedEnvironmentProvisionThreads(deps, environment.id).length >
      0 &&
    !listLiveEnvironmentThreads(deps, environment.id).some(
      (thread) => thread.status === "starting",
    )
  ) {
    const row = environment;
    const cancel = () =>
      runLiveHostCommand(deps, {
        command: { type: "environment.attach.cancel", environmentId: row.id },
        hostId: row.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      })
        .then(() => {})
        .catch((error) =>
          deps.logger.warn(
            { environmentId: row.id, error },
            "Environment cancellation failed",
          ),
        );
    const active = map.get(row.id);
    if (active !== undefined) active.cancellation ??= cancel();
    else runTrackedOperation({ kind: "attach", map, key: row.id, run: cancel });
    return;
  }
  if (environment.status === "destroyed") return;
  if (environment.status === "creating" && map.has(environment.id)) return;
  if (environment.status === "creating") {
    const owner =
      environment.ownerThreadId === null
        ? null
        : getThread(deps.db, environment.ownerThreadId);
    const context =
      owner === null ? null : getThreadProvisionContext(deps.db, owner.id);
    const record =
      args.creation?.record ??
      (environment.environmentProviderId === null
        ? undefined
        : getEnvironmentProvider(environment.environmentProviderId));
    if (record === undefined) return;
    const row = environment;
    const operation = runTrackedOperation({
      kind: "create",
      map,
      key: row.id,
      run: async (signal) => {
        const creation =
          args.creation?.context ??
          (owner !== null &&
          context?.request.environmentIntent.type === "provider"
            ? await resolveProviderOperationContext(
                deps,
                owner,
                context.request.environmentIntent,
                record,
              )
            : null);
        if (creation === null) return;
        await runCreate(deps, record, row, creation, signal);
      },
    });
    void operation.done
      .then(async () => {
        const current =
          row.ownerThreadId === null
            ? null
            : getPreparingEnvironment(deps.db, row.ownerThreadId);
        if (current !== null && current.status !== "creating")
          await advanceEnvironmentProvisioning(deps, {
            environmentId: current.id,
          });
      })
      .catch((error) =>
        deps.logger.warn(
          { environmentId: row.id, error },
          "Environment advancement failed",
        ),
      );
    return;
  }
  if (environment.status === "error") {
    if (
      environment.ownerThreadId !== null ||
      args.threadId === undefined ||
      getThread(deps.db, args.threadId)?.status !== "starting"
    )
      return;
    const outcome = applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: environment.id,
      event: { type: "provision.requested" },
    });
    if (!outcome.applied) return;
    writeEnvironment(deps, environment.id, {
      attempt: environment.attempt + 1,
      statusMessage: "Retrying workspace setup",
    });
    environment = getEnvironment(deps.db, environment.id)!;
  }
  const threadId = environment.ownerThreadId ?? args.threadId;
  if (threadId !== undefined && threadId !== null) {
    const context = getThreadProvisionContext(deps.db, threadId);
    if (context === null) return;
    const target = environment;
    if (
      target.status === "ready" &&
      target.ownerThreadId !== null &&
      target.path !== null
    )
      await refreshAttachedEnvironmentBranch(deps, {
        environmentId: target.id,
        hostId: target.hostId,
        path: target.path,
      });
    await withEnvironmentPathAdmission(deps, { ...target, threadId }, () =>
      deps.db.transaction(
        (tx) => {
          if (
            getThreadProvisionContext(tx, threadId)?.state.provisioningId !==
            context.state.provisioningId
          )
            return;
          updateThread(tx, deps.hub, threadId, { environmentId: target.id });
          markProviderEnvironmentAttached(tx, threadId, target.id);
          context.request.environmentIntent = {
            type: "reuse",
            environmentId: target.id,
          };
          context.state.environmentId = target.id;
          saveThreadProvisionContext({
            replace: false,
            db: tx,
            threadId,
            context,
          });
        },
        { behavior: "immediate" },
      ),
    );
    environment = getEnvironment(deps.db, environment.id);
    if (environment === null || environment.ownerThreadId !== null) return;
  }
  if (environment.status === "ready") {
    if (threadId != null && args.threadId === undefined)
      void advanceThreadProvisioning(deps, { threadId });
    return;
  }
  if (
    environment.status !== "provisioning" ||
    map.has(environment.id) ||
    findHostDataDir(deps, environment.hostId) === null
  )
    return;
  const request =
    args.request ?? recoverEnvironmentProvisionRequest(deps, environment);
  if (request === null) {
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      reason:
        "Environment setup did not finish. Retry provisioning to continue.",
    });
    return;
  }
  const row = environment;
  runTrackedOperation({
    kind: "attach",
    map,
    key: row.id,
    run: () =>
      runEnvironmentProvisionCommand(deps, { environment: row, request }),
  });
}

export async function sweepProviderEnvironment(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  await advanceEnvironmentProvisioning(deps, { environmentId, removal: true });
}
