import { and, eq } from "drizzle-orm";
import { hostDaemonSessions } from "@bb/db";
import { handleHostRemoved } from "../../internal/session-owner-side-effects.js";
import {
  beginMachineRestoreSetup,
  runMachineRestoreSetup,
} from "./restore-setup.js";
import type { WorkSessionDeps } from "../../types.js";
import { machineLifecycles } from "@bb/db";
import {
  getMachineLifecycle,
  maintainMachine,
  waitForMachineMaintenance,
} from "./lifecycle.js";
import type { MachineLaunchStatus } from "@bb/server-contract";
import { serverAccess } from "./server-access.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  deleteProjectSource,
  settleMachineEnrollments,
  getHost,
  getMachineLaunch,
  listEnvironments,
  listMachineLaunchesByPhase,
  listProjectSourcesByHost,
  listProviderMachines,
  listThreadIdsWithHostOfflineQueueWaits,
  machineHasLiveThreads,
  machineHasOpenTerminal,
  machineIdleSince,
  updateHost,
  updateMachineLaunchAttempt,
  upsertMachineLaunch,
  type MachineLaunchRow,
} from "@bb/db";
import { jsonValueSchema, type Host, type JsonValue } from "@bb/domain";
import type {
  PluginMachineProviderCreateResult,
  PluginMachineProviderProgress,
} from "@get-bb/plugin-sdk/machine-provider";
import { summarizeStandardIssues } from "@get-bb/plugin-sdk/internal/host-policy";
import { ApiError } from "../../errors.js";
import type { ThreadProvisioningDeps } from "../threads/thread-provisioning-environment.js";
import { decideWithinBox } from "../threads/dispatch-hooks.js";
import {
  getMachineProvider,
  invokeMachineProvider,
  listMachineProviders,
  machineProviderDecisionTimeoutMs,
  type PluginMachineProviderRecord,
} from "../plugins/plugin-machine-provider-registry.js";
import { requirePublicProject } from "../lib/entity-lookup.js";
import {
  requestEnvironmentRemoval,
  sweepProviderEnvironment,
} from "../environments/provider-orchestration.js";

type Deps = ThreadProvisioningDeps;
type MachineLifecycleDeps = Pick<Deps, "db" | "hub" | "logger">;

function expireMachineSessions(deps: Deps, hostId: string): void {
  for (const session of deps.db
    .select({ id: hostDaemonSessions.id })
    .from(hostDaemonSessions)
    .where(
      and(
        eq(hostDaemonSessions.hostId, hostId),
        eq(hostDaemonSessions.status, "active"),
      ),
    )
    .all()) {
    handleHostRemoved(deps, { hostId, sessionId: session.id });
  }
}

interface ActiveOperation {
  controller: AbortController;
  done: Promise<void>;
}

const TRANSIENT_RETRY_MS = 30_000;
const TRANSIENT_RETRY_LIMIT = 3;
const resourceSchema = jsonValueSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value)) <= 16_384,
  "Resource exceeds 16 KiB",
);
const createResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("created"),
    hostId: z.string().min(1),
    resource: resourceSchema,
  }),
  z.object({
    status: z.literal("failed"),
    failure: z.enum(["terminal", "transient"]),
    allocation: z.literal("none").optional(),
    message: z.string().min(1),
  }),
]);
const resourceResultSchema = z.object({ resource: resourceSchema }).strict();
const removeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("removed") }).strict(),
  z
    .object({ status: z.literal("failed"), message: z.string().min(1) })
    .strict(),
]);
const validateDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z
    .object({
      action: z.literal("refuse"),
      message: z.string().min(1).max(500),
    })
    .strict(),
]);

const createOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const cancelOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const suspendOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const resumeOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const removeOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const machineSweepOperations = new WeakMap<
  object,
  Map<string, ActiveOperation>
>();

function operations(
  registry: WeakMap<object, Map<string, ActiveOperation>>,
  db: Deps["db"],
): Map<string, ActiveOperation> {
  let map = registry.get(db);
  if (map === undefined) {
    map = new Map();
    registry.set(db, map);
  }
  return map;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function deleteMachineProjectSources(
  deps: MachineLifecycleDeps,
  hostId: string,
): void {
  for (const source of listProjectSourcesByHost(deps.db, hostId)) {
    deleteProjectSource(deps.db, deps.hub, source.id);
  }
}

function mutateLaunch(
  deps: Deps,
  launch: MachineLaunchRow,
  phases: MachineLaunchRow["phase"][],
  change: (row: MachineLaunchRow) => void,
): boolean {
  const row = getMachineLaunch(deps.db, launch.key);
  if (
    row === null ||
    row.attempt !== launch.attempt ||
    !phases.includes(row.phase)
  ) {
    return false;
  }
  change(row);
  return updateMachineLaunchAttempt(deps.db, row);
}

function launchReporter(
  deps: Deps,
  launch: MachineLaunchRow,
): PluginMachineProviderProgress {
  const update = (change: (row: MachineLaunchRow) => void): void => {
    mutateLaunch(deps, launch, ["creating"], change);
  };
  return {
    step: (text) =>
      update((row) => {
        row.stepText = text.slice(0, 200);
      }),
    log: (text) =>
      update((row) => {
        row.pendingLog = (row.pendingLog + text).slice(-16_384);
      }),
  };
}

function lifecycleReporter(
  deps: MachineLifecycleDeps,
  hostId: string,
): PluginMachineProviderProgress {
  const owner = getHost(deps.db, hostId);
  return {
    step: (text) => {
      const current = getHost(deps.db, hostId);
      if (
        current === null ||
        current.destroyedAt !== null ||
        owner === null ||
        current.machineOperationId !== owner.machineOperationId ||
        current.machineProviderId !== owner.machineProviderId ||
        current.phase !== owner.phase
      )
        return;
      updateHost(deps.db, deps.hub, hostId, {
        teardownMessage: text.slice(0, 500),
      });
      deps.hub.notifyHost(hostId, ["host-connected"]);
    },
    log: (text) => {
      deps.logger.info({ hostId }, text.slice(-16_384));
    },
  };
}

async function invokeCreate(
  record: PluginMachineProviderRecord,
  launch: MachineLaunchRow,
  deps: Deps,
  signal: AbortSignal,
): Promise<PluginMachineProviderCreateResult> {
  const project =
    launch.projectId === null
      ? null
      : requirePublicProject(deps.db, launch.projectId);
  const invocation = await invokeMachineProvider(record, "machine create", () =>
    record.provider.create({
      ...(project === null
        ? { project: null, gitRemote: null }
        : {
            project,
            gitRemote: record.provider.requires.gitRemote
              ? project.gitRemoteUrl
              : null,
          }),
      inputs: launch.inputs,
      key: launch.key,
      attempt: launch.attempt,
      checkpoint: async (resource) => {
        const parsed = resourceSchema.parse(resource);
        const updated = mutateLaunch(
          deps,
          launch,
          ["creating", "cancelled", "failed"],
          (row) => {
            if (row.hostId === null)
              throw new Error(
                "Prepare enrollment before checkpointing a machine resource",
              );
            row.resource = parsed;
            row.cleanupResourceRemoved = false;
          },
        );
        if (!updated)
          throw new Error(
            "Machine launch attempt no longer owns this resource",
          );
      },
      report: launchReporter(deps, launch),
      signal,
    }),
  );
  if (!invocation.ok) throw new Error(invocation.error);
  const result = createResultSchema.parse(invocation.value);
  const reservedHostId =
    getMachineLaunch(deps.db, launch.key)?.hostId ?? launch.hostId;
  if (
    result.status === "created" &&
    reservedHostId !== null &&
    result.hostId !== reservedHostId
  ) {
    throw new Error(
      `Machine provider "${record.provider.id}" returned host "${result.hostId}" instead of reserved host "${reservedHostId}"`,
    );
  }
  return result;
}

async function removeResource(
  deps: Deps,
  record: PluginMachineProviderRecord,
  args: { hostId: string; resource: JsonValue; signal: AbortSignal },
): Promise<void> {
  const invocation = await invokeMachineProvider(record, "machine remove", () =>
    record.provider.remove({
      hostId: args.hostId,
      resource: args.resource,
      report: lifecycleReporter(deps, args.hostId),
      signal: args.signal,
    }),
  );
  if (!invocation.ok) throw new Error(invocation.error);
  const result = removeResultSchema.parse(invocation.value);
  if (result.status === "failed") throw new Error(result.message);
}

async function runCreate(
  deps: Deps,
  record: PluginMachineProviderRecord,
  launch: MachineLaunchRow,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await invokeCreate(record, launch, deps, signal);
    if (result.status === "failed") {
      mutateLaunch(deps, launch, ["creating"], (row) => {
        row.phase = "failed";
        row.failure = result.failure;
        row.message = result.message;
        row.failedAt = Date.now();
        if (result.allocation === "none" && row.resource === null) {
          row.cleanupResourceRemoved = true;
          row.cancelPending = true;
        }
        if (result.failure === "transient") row.transientFailures += 1;
      });
      return;
    }
    const current = getMachineLaunch(deps.db, launch.key);
    if (
      current === null ||
      current.attempt !== launch.attempt ||
      current.phase !== "creating"
    ) {
      if (
        current?.phase === "cancelled" &&
        current.attempt === launch.attempt
      ) {
        updateMachineLaunchAttempt(deps.db, {
          ...current,
          hostId: result.hostId,
          resource: result.resource,
          cleanupResourceRemoved: false,
        });
      } else {
        await removeResource(deps, record, {
          ...result,
          signal: new AbortController().signal,
        });
      }
      return;
    }
    const host = getHost(deps.db, result.hostId);
    if (host === null || host.destroyedAt !== null) {
      await removeResource(deps, record, { ...result, signal });
      throw new Error(
        `Machine provider "${record.provider.id}" returned host "${result.hostId}" without enrolling it`,
      );
    }
    if (
      host.machineProviderId !== null &&
      host.machineProviderId !== record.provider.id
    ) {
      await removeResource(deps, record, { ...result, signal });
      throw new Error(
        `Machine provider "${record.provider.id}" returned host "${result.hostId}", which belongs to "${host.machineProviderId}"`,
      );
    }
    updateHost(deps.db, deps.hub, result.hostId, {
      machineProviderId: record.provider.id,
      machineProviderSelection: { inputs: launch.inputs },
      phase: "active",
      resource: result.resource,
      retireAt: null,
      suspendedAt: null,
      teardownAttempt: 0,
      teardownMessage: null,
      teardownStatus: null,
    });
    deps.hub.notifyHost(result.hostId, ["host-connected"]);
    mutateLaunch(deps, launch, ["creating"], (row) => {
      row.phase = "ready";
      row.hostId = result.hostId;
      row.resource = result.resource;
      row.message = null;
      row.failure = null;
      row.failedAt = null;
    });
  } catch (error) {
    const current = getMachineLaunch(deps.db, launch.key);
    if (signal.aborted && current?.phase === "cancelled") return;
    mutateLaunch(deps, launch, ["creating"], (row) => {
      row.phase = "failed";
      row.failure = "terminal";
      row.message = `The "${record.provider.id}" machine provider (plugin "${record.pluginId}") failed: ${errorMessage(error)}`;
      row.failedAt = Date.now();
    });
  }
}

function startCreate(
  deps: Deps,
  record: PluginMachineProviderRecord,
  launch: MachineLaunchRow,
): ActiveOperation {
  const operation = runTrackedOperation({
    map: operations(createOperations, deps.db),
    key: `${launch.key}:${launch.attempt}`,
    run: (signal) => runCreate(deps, record, launch, signal),
  });
  void operation.done
    .then(async () => {
      const current = getMachineLaunch(deps.db, launch.key);
      if (current?.phase === "failed" && current.failure === "terminal") {
        await cancelMachineLaunch(deps, launch.key, true);
      }
    })
    .catch((error: unknown) => {
      deps.logger.warn(
        { key: launch.key, error: errorMessage(error) },
        "Machine creation cleanup failed",
      );
    });
  return operation;
}

export async function parseMachineProviderInputs(
  record: PluginMachineProviderRecord,
  inputs: JsonValue | null,
): Promise<JsonValue | null> {
  const schema = record.provider.inputs;
  if (schema === null) {
    if (inputs !== null) {
      throw new ApiError(
        400,
        "invalid_request",
        `The "${record.provider.id}" machine provider takes no inputs, but the request carried some`,
      );
    }
    return null;
  }
  if (inputs === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `The "${record.provider.id}" machine provider needs inputs, and the request carried none`,
    );
  }
  const invocation = await invokeMachineProvider(
    record,
    `"${record.provider.id}" machine provider inputs`,
    async () => schema["~standard"].validate(inputs),
  );
  if (!invocation.ok) {
    throw new ApiError(
      502,
      "machine_provider_failed",
      `The "${record.provider.id}" machine provider (plugin "${record.pluginId}") failed to validate its inputs: ${invocation.error}`,
    );
  }
  if (invocation.value.issues !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `The "${record.provider.id}" machine provider refused the inputs: ${summarizeStandardIssues(invocation.value.issues)}`,
    );
  }
  const parsed = jsonValueSchema.safeParse(invocation.value.value);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "machine_provider_failed",
      `The "${record.provider.id}" machine provider parsed its inputs into a value that is not JSON`,
    );
  }
  return parsed.data;
}

export async function prepareMachineProviderSelection(
  deps: Deps,
  args: {
    machineProviderId: string;
    projectId: string | null;
    inputs: JsonValue | null;
  },
): Promise<{ record: PluginMachineProviderRecord; inputs: JsonValue | null }> {
  const record = getMachineProvider(args.machineProviderId);
  if (record === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unknown machine provider "${args.machineProviderId}"`,
    );
  }
  const project =
    args.projectId === null
      ? null
      : requirePublicProject(deps.db, args.projectId);
  if (
    record.provider.requires.gitRemote &&
    project !== null &&
    project.gitRemoteUrl === null
  ) {
    throw new ApiError(
      409,
      "machine_provider_rejected",
      `${project.name} has no git remote, so the "${record.provider.id}" machine provider has nothing to clone.`,
    );
  }
  const inputs = await parseMachineProviderInputs(record, args.inputs);
  if (record.provider.validate !== null) {
    const invocation = await invokeMachineProvider(
      record,
      `"${record.provider.id}" machine provider validate`,
      () =>
        decideWithinBox(
          () =>
            Promise.resolve(
              record.provider.validate?.({
                ...(project === null
                  ? { project: null, gitRemote: null }
                  : {
                      project,
                      gitRemote: record.provider.requires.gitRemote
                        ? project.gitRemoteUrl
                        : null,
                    }),
                inputs,
              }),
            ),
          machineProviderDecisionTimeoutMs(),
        ),
    );
    if (!invocation.ok) {
      throw new ApiError(
        502,
        "machine_provider_failed",
        `The "${record.provider.id}" machine provider failed to validate the request: ${invocation.error}`,
      );
    }
    if (!invocation.value.ok) {
      throw new ApiError(
        502,
        "machine_provider_failed",
        `The "${record.provider.id}" machine provider failed to validate the request: ${invocation.value.error}`,
      );
    }
    const decision = validateDecisionSchema.safeParse(invocation.value.value);
    if (!decision.success) {
      throw new ApiError(
        502,
        "machine_provider_failed",
        `The "${record.provider.id}" machine provider returned an invalid validate decision`,
      );
    }
    if (decision.data.action === "refuse") {
      throw new ApiError(
        409,
        "machine_provider_rejected",
        decision.data.message,
      );
    }
  }
  return { record, inputs };
}

export type MachineLaunchDecision =
  | { action: "wait"; reason: string; sendAt: number; log: string }
  | { action: "reject"; message: string }
  | { action: "ready"; host: Host; log: string };

export function resolveThreadMachineLaunchKey(
  deps: Pick<Deps, "db">,
  threadId: string,
): string {
  let key = threadId;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(key))
      throw new Error("Machine replacement history contains a cycle");
    visited.add(key);
    const launch = getMachineLaunch(deps.db, key);
    if (launch?.phase !== "ready" || launch.hostId === null) return key;
    const host = getHost(deps.db, launch.hostId);
    if (
      host !== null &&
      host.destroyedAt === null &&
      host.removalStartedAt === null
    )
      return key;
    key = `${threadId}:replacement:${launch.hostId}`;
  }
}

export function askMachineLaunch(
  deps: Deps,
  args: {
    key: string;
    record: PluginMachineProviderRecord;
    projectId: string | null;
    inputs: JsonValue | null;
  },
): MachineLaunchDecision {
  const now = Date.now();
  let row = getMachineLaunch(deps.db, args.key);
  const changed =
    row !== null &&
    (row.providerId !== args.record.provider.id ||
      row.projectId !== args.projectId ||
      JSON.stringify(row.inputs) !== JSON.stringify(args.inputs));
  if (changed) {
    throw new ApiError(
      409,
      "machine_launch_key_conflict",
      `Machine launch key "${args.key}" is already in use`,
    );
  }
  if (row?.phase === "ready") {
    const host = row.hostId === null ? null : getHost(deps.db, row.hostId);
    if (
      host !== null &&
      host.destroyedAt === null &&
      host.removalStartedAt === null
    ) {
      return {
        action: "ready",
        host: machineHostResponse(host, deps),
        log: takeLaunchLog(deps, row),
      };
    }
    return {
      action: "reject",
      message: `Machine launch key "${args.key}" belongs to a destroyed machine; use a new key to create a replacement`,
    };
  }
  if (row?.phase === "failed") {
    if (
      row.failure === "terminal" ||
      row.transientFailures > TRANSIENT_RETRY_LIMIT
    ) {
      return {
        action: "reject",
        message: row.message ?? "Machine creation failed",
      };
    }
    const retryAt = (row.failedAt ?? now) + TRANSIENT_RETRY_MS;
    if (now < retryAt) {
      return {
        action: "wait",
        reason: `${row.message ?? "Machine creation failed"}; retrying`,
        sendAt: retryAt,
        log: takeLaunchLog(deps, row),
      };
    }
  }
  if (row === null || row.phase === "failed") {
    const attempt = (row?.attempt ?? 0) + 1;
    row = {
      key: args.key,
      providerId: args.record.provider.id,
      projectId: args.projectId,
      inputs: args.inputs,
      attempt,
      phase: "creating",
      startedAt: now,
      failedAt: null,
      failure: null,
      message: null,
      transientFailures: row?.transientFailures ?? 0,
      hostId: row?.hostId ?? null,
      resource: row?.resource ?? null,
      stepText: `Creating ${args.record.provider.displayName}…`,
      pendingLog: "",
      cancelPending: false,
      cleanupResourceRemoved: false,
      cleanupRetryAt: null,
    };
    upsertMachineLaunch(deps.db, row);
    startCreate(deps, args.record, row);
  } else if (row.phase === "creating") {
    startCreate(deps, args.record, row);
  } else if (row.phase === "cancelled") {
    return { action: "reject", message: "Machine creation was cancelled" };
  }
  return {
    action: "wait",
    reason: row.stepText,
    sendAt: now + 1_000,
    log: takeLaunchLog(deps, row),
  };
}

function takeLaunchLog(deps: Deps, row: MachineLaunchRow): string {
  const log = row.pendingLog;
  if (log.length > 0) {
    updateMachineLaunchAttempt(deps.db, { ...row, pendingLog: "" });
  }
  return log;
}

function machineHostResponse(
  row: NonNullable<ReturnType<typeof getHost>>,
  deps: Deps,
): Host {
  return {
    id: row.id,
    name: row.name,
    status: deps.hub.hasDaemonForHost(row.id) ? "connected" : "disconnected",
    machineProviderId: row.machineProviderId,
    machineProviderSelection: row.machineProviderSelection,
    lifecycle: {
      phase: row.phase === "suspending" ? "active" : row.phase,
      suspendedAt: row.suspendedAt,
      retireAt: row.retireAt,
      progress: row.teardownStatus === null ? row.teardownMessage : null,
      teardown:
        row.teardownStatus === null
          ? null
          : {
              status: row.teardownStatus,
              attempt: row.teardownAttempt,
              ...(row.teardownMessage === null
                ? {}
                : { message: row.teardownMessage }),
            },
    },
    maxPermissionMode: row.maxPermissionMode,
    lastSeenAt: row.lastSeenAt,
    lastRejectedProtocolVersion: row.lastRejectedProtocolVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function cancelMachineLaunch(
  deps: Deps,
  key: string,
  preserveFailure = false,
  forceRetry = false,
): Promise<void> {
  let row = getMachineLaunch(deps.db, key);
  if (row === null || row.phase === "ready") return;
  if (
    row.phase !== "cancelled" &&
    !(
      row.phase === "failed" &&
      row.cleanupResourceRemoved &&
      !row.cancelPending
    )
  ) {
    row = {
      ...row,
      phase: preserveFailure ? "failed" : "cancelled",
      cancelPending: true,
    };
    updateMachineLaunchAttempt(deps.db, row);
  }
  if (row.cleanupResourceRemoved && !row.cancelPending) return;
  if (row.hostId !== null) {
    settleMachineEnrollments(deps.db, row.hostId);
    await deps.machineAuth.revokeHostEnrollKeys({ hostId: row.hostId });
  }
  const create = operations(createOperations, deps.db).get(
    `${row.key}:${row.attempt}`,
  );
  if (create !== undefined) {
    create.controller.abort();
    await create.done;
  }
  row = getMachineLaunch(deps.db, key);
  if (
    row === null ||
    !row.cancelPending ||
    (!forceRetry &&
      row.cleanupRetryAt !== null &&
      row.cleanupRetryAt > Date.now())
  )
    return;
  const record = getMachineProvider(row.providerId);
  if (record === undefined) return;
  const operation = runTrackedOperation({
    map: operations(cancelOperations, deps.db),
    key,
    run: async (signal) => {
      let current = getMachineLaunch(deps.db, key);
      if (current === null || !current.cancelPending) return;
      let allocationError: Error | null = null;
      try {
        if (!current.cleanupResourceRemoved) {
          if (current.resource === null) {
            const launch = current;
            const invocation = await invokeMachineProvider(
              record,
              "machine cleanup reconciliation",
              () =>
                record.provider.reconcileCleanup({
                  key: launch.key,
                  report: launchReporter(deps, launch),
                  signal,
                }),
            );
            if (!invocation.ok) throw new Error(invocation.error);
            const result = removeResultSchema.parse(invocation.value);
            if (result.status === "failed") throw new Error(result.message);
          } else {
            if (current.hostId === null)
              throw new Error("Machine cleanup has no reserved host");
            await removeResource(deps, record, {
              hostId: current.hostId,
              resource: current.resource,
              signal,
            });
          }
          current = { ...current, cleanupResourceRemoved: true };
          updateMachineLaunchAttempt(deps.db, current);
        }
      } catch (error) {
        allocationError = new Error(errorMessage(error));
      }
      const removedHostId = current.hostId;
      if (removedHostId !== null) {
        await serverAccess.release(deps, { key, hostId: removedHostId });
        deleteMachineProjectSources(deps, removedHostId);
        await deps.machineAuth.revokeHostAuthKeys({ hostId: removedHostId });
        expireMachineSessions(deps, removedHostId);
        const host = getHost(deps.db, removedHostId);
        if (host !== null && host.destroyedAt === null) {
          updateHost(deps.db, deps.hub, removedHostId, {
            destroyedAt: Date.now(),
            phase: "destroyed",
            resource: null,
            retireAt: null,
            suspendedAt: null,
            teardownStatus: "removed",
            teardownMessage: null,
          });
          deps.hub.notifyHost(removedHostId, ["host-disconnected"]);
        }
      }

      if (allocationError !== null) throw allocationError;
      updateMachineLaunchAttempt(deps.db, {
        ...current,
        cancelPending: false,
        cleanupRetryAt: null,
        resource: null,
      });
    },
  });
  try {
    await operation.done;
  } catch (error) {
    const current = getMachineLaunch(deps.db, key);
    if (current !== null && current.cancelPending) {
      updateMachineLaunchAttempt(deps.db, {
        ...current,
        cleanupRetryAt:
          current.resource === null &&
          !current.cleanupResourceRemoved &&
          current.hostId === null &&
          Date.now() - current.startedAt >= 30 * 60_000
            ? Number.MAX_SAFE_INTEGER
            : Date.now() + 60_000,
      });
    }
    throw error;
  }
}

export function machineLaunchStatus(
  deps: Deps,
  key: string,
): MachineLaunchStatus {
  const row = getMachineLaunch(deps.db, key);
  if (row === null)
    throw new ApiError(
      404,
      "machine_launch_not_found",
      "Machine launch not found",
    );
  return {
    id: row.key,
    phase: row.phase,
    hostId: row.hostId,
    step: row.stepText,
    log: row.pendingLog,
    message: row.message,
    cancelPending: row.cancelPending,
    terminal:
      row.phase === "ready" ||
      row.phase === "cancelled" ||
      (row.phase === "failed" &&
        (row.failure === "terminal" ||
          row.transientFailures > TRANSIENT_RETRY_LIMIT)),
  };
}

export async function submitMachine(
  deps: Deps,
  args: {
    key?: string;
    machineProviderId: string;
    projectId: string | null;
    inputs: JsonValue | null;
  },
): Promise<MachineLaunchStatus> {
  const key = args.key ?? `machine-${randomUUID()}`;
  const prepared = await prepareMachineProviderSelection(deps, args);
  const decision = askMachineLaunch(deps, {
    key,
    record: prepared.record,
    projectId: args.projectId,
    inputs: prepared.inputs,
  });
  if (
    decision.action === "reject" &&
    getMachineLaunch(deps.db, key)?.phase === "ready"
  )
    throw new ApiError(409, "machine_provider_rejected", decision.message);
  return machineLaunchStatus(deps, key);
}

export async function createMachine(
  deps: Deps,
  args: Parameters<typeof submitMachine>[1] & { signal?: AbortSignal },
): Promise<Host> {
  const launch = await submitMachine(deps, args);
  for (;;) {
    args.signal?.throwIfAborted();
    const status = machineLaunchStatus(deps, launch.id);
    if (status.phase === "ready" && status.hostId !== null) {
      const host = getHost(deps.db, status.hostId);
      if (host !== null) return machineHostResponse(host, deps);
    }
    if (status.terminal) {
      throw new ApiError(
        409,
        "machine_provider_rejected",
        status.message ?? "Machine creation cancelled",
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}

function lifecycleOwns(
  current: ReturnType<typeof getHost>,
  providerId: string,
  operationId: string,
  phase:
    | NonNullable<ReturnType<typeof getHost>>["phase"]
    | NonNullable<ReturnType<typeof getHost>>["phase"][],
): current is NonNullable<ReturnType<typeof getHost>> {
  return (
    current !== null &&
    current.destroyedAt === null &&
    current.removalStartedAt === null &&
    current.machineProviderId === providerId &&
    current.machineOperationId === operationId &&
    operationId.startsWith(`${getMachineProvider(providerId)?.pluginId}:`) &&
    (Array.isArray(phase)
      ? phase.includes(current.phase)
      : current.phase === phase)
  );
}

async function suspendMachine(deps: Deps, hostId: string): Promise<void> {
  const removing = operations(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done.catch(() => {});
    return;
  }
  const resuming = operations(resumeOperations, deps.db).get(hostId);
  if (resuming !== undefined) {
    await resuming.done.catch(() => {});
  }
  const suspending = operations(suspendOperations, deps.db).get(hostId);
  if (suspending !== undefined) {
    await suspending.done;
    return;
  }
  const row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    (row.phase !== "active" &&
      !(row.phase === "retiring" && row.suspendedAt === null))
  ) {
    return;
  }
  const record = getMachineProvider(row.machineProviderId);
  if (record === undefined || record.provider.suspend === null) return;
  if (row.resource === null) {
    throw new Error(`Machine "${hostId}" has no provider resource`);
  }
  const operationId = `${record.pluginId}:${randomUUID()}`;
  if (
    machineIdleSince(deps.db, hostId) === null ||
    machineHasOpenTerminal(deps.db, hostId)
  ) {
    throw new ApiError(
      409,
      "machine_busy",
      "Wait for live threads to become idle and close terminals before sleeping.",
    );
  }
  const suspend = record.provider.suspend;
  const resource = row.resource;
  const retiring = row.phase === "retiring";
  const maintenanceLease = getMachineLifecycle(deps, hostId)?.leaseId ?? null;
  const operation = runTrackedOperation({
    map: operations(suspendOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      updateHost(deps.db, deps.hub, hostId, {
        phase: "suspending",
        machineOperationId: operationId,
        teardownMessage: null,
        teardownStatus: null,
      });
      const invocation = await invokeMachineProvider(
        record,
        "machine suspend",
        () =>
          suspend({
            hostId,
            resource,
            report: lifecycleReporter(deps, hostId),
            signal,
            checkpoint: (checkpoint) => {
              const parsed = resourceSchema.parse(checkpoint);
              if (
                maintenanceLease !== null &&
                getMachineLifecycle(deps, hostId)?.leaseId !== maintenanceLease
              )
                throw new Error(
                  "Machine maintenance lease was replaced before checkpoint",
                );
              const current = getHost(deps.db, hostId);
              if (
                !lifecycleOwns(current, record.provider.id, operationId, [
                  "suspending",
                  "retiring",
                ])
              ) {
                throw new Error(`Machine "${hostId}" is no longer active`);
              }
              updateHost(deps.db, deps.hub, hostId, {
                resource: parsed,
              });
            },
          }),
      );
      if (!invocation.ok) throw new Error(invocation.error);
      const result = resourceResultSchema.parse(invocation.value);
      const current = getHost(deps.db, hostId);
      if (
        !lifecycleOwns(current, record.provider.id, operationId, [
          "suspending",
          "retiring",
        ])
      ) {
        return;
      }
      updateHost(deps.db, deps.hub, hostId, {
        phase:
          retiring || current.phase === "retiring" ? "retiring" : "suspended",
        resource: result.resource,
        suspendedAt: Date.now(),
        teardownMessage: null,
        teardownStatus: null,
      });
      deps.hub.notifyHost(hostId, ["host-disconnected"]);
    },
  });
  await operation.done;
}

function requireSuspendableMachine(deps: Deps, hostId: string) {
  const row = getHost(deps.db, hostId);
  if (row === null || row.destroyedAt !== null) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  if (row.machineProviderId === null) {
    throw new ApiError(
      409,
      "machine_provider_unavailable",
      "This machine is not managed by a machine provider",
    );
  }
  const record = getMachineProvider(row.machineProviderId);
  if (
    record === undefined ||
    record.provider.suspend === null ||
    record.provider.resume === null
  ) {
    throw new ApiError(
      409,
      "machine_suspend_unsupported",
      `Machine provider "${row.machineProviderId}" does not support suspend and resume`,
    );
  }
  return row;
}

export async function requestMachineSuspension(
  deps: Deps,
  hostId: string,
): Promise<void> {
  const row = requireSuspendableMachine(deps, hostId);
  if (row.phase !== "active" && row.phase !== "suspending") {
    throw new ApiError(
      409,
      "machine_not_active",
      "Only an active machine can be suspended",
    );
  }
  await maintainMachine(deps, hostId, () => suspendMachine(deps, hostId));
}

export async function requestMachineResume(
  deps: Deps,
  hostId: string,
): Promise<void> {
  await waitForMachineMaintenance(deps, hostId);
  const row = requireSuspendableMachine(deps, hostId);
  if (
    row.phase !== "active" &&
    row.phase !== "suspended" &&
    row.phase !== "suspending"
  ) {
    throw new ApiError(
      409,
      "machine_not_suspended",
      "Only an active or suspended machine can be resumed",
    );
  }
  await resumeMachine(deps, hostId);
}

export async function resumeMachine(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  const removing = operations(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done.catch(() => {});
    return;
  }
  const suspending = operations(suspendOperations, deps.db).get(hostId);
  if (suspending !== undefined) {
    await suspending.done.catch(() => {});
  }
  await resumeMachineWithIntent(deps, hostId, false);
}

async function resumeMachineWithIntent(
  deps: WorkSessionDeps,
  hostId: string,
  preserveRetirement: boolean,
): Promise<void> {
  let row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    row.removalStartedAt !== null
  )
    return;
  const hasLiveThreads = machineHasLiveThreads(deps.db, hostId);
  if (row.phase === "retiring" && row.suspendedAt === null && hasLiveThreads) {
    updateHost(deps.db, deps.hub, hostId, {
      phase: "active",
      retireAt: null,
      teardownMessage: null,
      teardownStatus: null,
    });
    return;
  }
  if (
    row.phase !== "suspended" &&
    row.phase !== "suspending" &&
    !(
      row.phase === "retiring" &&
      row.suspendedAt !== null &&
      (hasLiveThreads || preserveRetirement)
    )
  ) {
    return;
  }
  const machineProviderId = row.machineProviderId;
  const record = getMachineProvider(machineProviderId);
  if (record === undefined || record.provider.resume === null) {
    throw new ApiError(
      409,
      "machine_provider_unavailable",
      `Machine provider "${machineProviderId}" is not installed`,
    );
  }
  if (row.resource === null) {
    throw new Error(`Machine "${hostId}" has no provider resource`);
  }
  deps.db
    .insert(machineLifecycles)
    .values({ hostId, recoveryState: "healthy" })
    .onConflictDoNothing()
    .run();
  const operationId = `${record.pluginId}:${randomUUID()}`;
  const phase = row.phase;
  const resume = record.provider.resume;
  const resource = row.resource;
  const operation = runTrackedOperation({
    map: operations(resumeOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      updateHost(deps.db, deps.hub, hostId, {
        machineOperationId: operationId,
      });
      const invocation = await invokeMachineProvider(
        record,
        "machine resume",
        () =>
          resume({
            hostId,
            resource,
            checkpoint: async (checkpoint) => {
              const parsed = resourceSchema.parse(checkpoint);
              const current = getHost(deps.db, hostId);
              if (
                !lifecycleOwns(current, record.provider.id, operationId, phase)
              ) {
                throw new Error(
                  `Machine "${hostId}" resume no longer owns this resource`,
                );
              }
              updateHost(deps.db, deps.hub, hostId, { resource: parsed });
            },
            report: lifecycleReporter(deps, hostId),
            signal,
          }),
      );
      if (!invocation.ok) throw new Error(invocation.error);
      const result = resourceResultSchema.parse(invocation.value);
      const current = getHost(deps.db, hostId);
      if (!lifecycleOwns(current, record.provider.id, operationId, phase)) {
        return;
      }
      const keepRetiring =
        current.phase === "retiring" && !machineHasLiveThreads(deps.db, hostId);
      beginMachineRestoreSetup(deps, hostId, operationId);
      updateHost(deps.db, deps.hub, hostId, {
        phase: keepRetiring ? "retiring" : "active",
        resource: result.resource,
        suspendedAt: null,
        retireAt: keepRetiring ? current.retireAt : null,
        teardownMessage: null,
        teardownStatus: null,
      });
      deps.hub.notifyHost(hostId, ["host-connected"]);
    },
  });
  try {
    await operation.done;
    if (getMachineLifecycle(deps, hostId) !== undefined) {
      deps.db
        .update(machineLifecycles)
        .set({
          recoveryState: "healthy",
          retryAt: null,
        })
        .where(eq(machineLifecycles.hostId, hostId))
        .run();
      await runMachineRestoreSetup(deps, hostId);
    }
  } catch (error) {
    deps.db
      .update(machineLifecycles)
      .set({
        recoveryState: "recoverable",
        message: `Machine resume failed: ${errorMessage(error)}`,
      })
      .where(eq(machineLifecycles.hostId, hostId))
      .run();
    throw error;
  }
}

async function resumeRetiringMachine(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  await resumeMachineWithIntent(deps, hostId, true);
}

export function requestMachineRemoval(deps: Deps, hostId: string): boolean {
  const row = getHost(deps.db, hostId);
  if (row === null || row.destroyedAt !== null) return false;
  if (row.machineProviderId === null) return false;
  if (machineHasLiveThreads(deps.db, hostId)) return false;
  updateHost(deps.db, deps.hub, hostId, {
    phase: "retiring",
    machineOperationId:
      row.phase === "suspending" ? row.machineOperationId : null,
    retireAt: Date.now(),
    teardownStatus: null,
    teardownMessage: null,
  });
  deps.hub.notifyHost(hostId, ["host-disconnected"]);
  return true;
}

export async function retryMachineCleanup(
  deps: Deps,
  hostId: string,
): Promise<void> {
  const row = getHost(deps.db, hostId);
  if (row === null || row.destroyedAt !== null) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
  if (
    row.machineProviderId === null ||
    row.phase !== "retiring" ||
    row.teardownStatus !== "failed"
  ) {
    throw new ApiError(
      409,
      "machine_cleanup_not_failed",
      "Cleanup can only be retried after machine teardown fails",
    );
  }
  updateHost(deps.db, deps.hub, hostId, { retireAt: Date.now() });
  await sweepProviderMachine(deps, hostId);
}

async function removeMachine(deps: Deps, hostId: string): Promise<void> {
  let removing = operations(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done;
    return;
  }
  const suspending = operations(suspendOperations, deps.db).get(hostId);
  const resuming = operations(resumeOperations, deps.db).get(hostId);
  await Promise.all([
    suspending?.done.catch(() => {}),
    resuming?.done.catch(() => {}),
  ]);
  removing = operations(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done;
    return;
  }
  const row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    row.destroyedAt !== null ||
    (row.removalStartedAt === null && machineHasLiveThreads(deps.db, hostId))
  ) {
    return;
  }
  const record = getMachineProvider(row.machineProviderId);
  if (record === undefined) return;
  if (row.resource === null) {
    updateHost(deps.db, deps.hub, hostId, {
      teardownStatus: "failed",
      teardownMessage: `Machine "${hostId}" has no provider resource`,
      retireAt: Date.now() + 60_000,
    });
    return;
  }
  const resource = row.resource;
  const operationId = `${record.pluginId}:${randomUUID()}`;
  const attempt = row.teardownAttempt + 1;
  updateHost(deps.db, deps.hub, hostId, {
    removalStartedAt: row.removalStartedAt ?? Date.now(),
    machineOperationId: operationId,
    teardownAttempt: attempt,
    teardownStatus: "running",
    teardownMessage: null,
  });
  const operation = runTrackedOperation({
    map: operations(removeOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      try {
        await removeResource(deps, record, {
          hostId,
          resource,
          signal,
        });
        const current = getHost(deps.db, hostId);
        if (
          current?.machineOperationId !== operationId ||
          current.machineProviderId !== record.provider.id ||
          current.phase !== "retiring" ||
          getMachineProvider(record.provider.id)?.pluginId !== record.pluginId
        )
          return;
        settleMachineEnrollments(deps.db, hostId);
        await deps.machineAuth.revokeHostEnrollKeys({ hostId });
        await serverAccess.release(deps, { key: hostId, hostId });
        deleteMachineProjectSources(deps, hostId);
        await deps.machineAuth.revokeHostAuthKeys({ hostId });
        expireMachineSessions(deps, hostId);
        const latest = getHost(deps.db, hostId);
        if (
          latest?.machineOperationId !== operationId ||
          latest.phase !== "retiring" ||
          getMachineProvider(record.provider.id)?.pluginId !== record.pluginId
        )
          return;
        updateHost(deps.db, deps.hub, hostId, {
          destroyedAt: Date.now(),
          phase: "destroyed",
          resource: null,
          retireAt: null,
          suspendedAt: null,
          teardownStatus: "removed",
          teardownMessage: null,
        });
        deps.hub.notifyHost(hostId, ["host-disconnected"]);
      } catch (error) {
        const current = getHost(deps.db, hostId);
        if (
          current?.machineOperationId !== operationId ||
          current.machineProviderId !== record.provider.id ||
          current.phase !== "retiring" ||
          getMachineProvider(record.provider.id)?.pluginId !== record.pluginId
        )
          return;
        updateHost(deps.db, deps.hub, hostId, {
          teardownStatus: "failed",
          teardownMessage: errorMessage(error),
          retireAt: Date.now() + 60_000,
        });
      }
    },
  });
  await operation.done;
}

export async function sweepProviderMachine(
  deps: Deps,
  hostId: string,
): Promise<void> {
  let row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    row.phase === "destroyed"
  ) {
    return;
  }
  const record = getMachineProvider(row.machineProviderId);
  if (record === undefined) return;
  const maintenance = getMachineLifecycle(deps, hostId);
  if (maintenance?.leaseId != null) {
    if (
      maintenance.leaseUntil !== null &&
      maintenance.leaseUntil > Date.now()
    ) {
      if (row.phase !== "retiring") return;
      await waitForMachineMaintenance(deps, hostId);
      row = getHost(deps.db, hostId);
      if (row === null) return;
    }
    deps.db
      .update(machineLifecycles)
      .set({
        leaseId: null,
        leaseUntil: null,
        recoveryState: row.suspendedAt !== null ? "saved" : "recoverable",
        message:
          row.suspendedAt !== null
            ? null
            : "Machine suspension was interrupted; recovery will use the last persisted provider resource.",
      })
      .where(eq(machineLifecycles.hostId, hostId))
      .run();
  }
  if (
    row.suspendedAt !== null &&
    listThreadIdsWithHostOfflineQueueWaits(deps.db, hostId).length > 0
  ) {
    await resumeMachine(deps, hostId);
    return;
  }
  if (row.phase === "suspending") {
    const suspending = operations(suspendOperations, deps.db).get(hostId);
    if (suspending !== undefined) {
      await suspending.done;
      return;
    }
    await resumeMachine(deps, hostId);
    return;
  }
  const now = Date.now();
  if (row.removalStartedAt !== null) {
    if (
      !operations(removeOperations, deps.db).has(hostId) &&
      (row.retireAt === null || row.retireAt <= now)
    ) {
      await removeMachine(deps, hostId);
    }
    return;
  }
  if (operations(resumeOperations, deps.db).has(hostId)) return;
  const hasLiveThreads = machineHasLiveThreads(deps.db, hostId);
  if (
    row.phase === "retiring" &&
    row.removalStartedAt === null &&
    hasLiveThreads
  ) {
    updateHost(deps.db, deps.hub, hostId, {
      phase: row.suspendedAt === null ? "active" : "suspended",
      retireAt: null,
      teardownMessage: null,
      teardownStatus: null,
    });
    row = getHost(deps.db, hostId);
    if (row === null) return;
  }
  const idleSuspendMs =
    record.provider.experimental_idleSuspendMs !== null && row.resource !== null
      ? z
          .number()
          .int()
          .nonnegative()
          .nullable()
          .parse(
            await record.provider.experimental_idleSuspendMs({
              hostId,
              resource: row.resource,
            }),
          )
      : null;
  const idleSince =
    row.phase === "active" ? machineIdleSince(deps.db, hostId) : null;
  if (
    row.phase === "active" &&
    idleSuspendMs !== null &&
    record.provider.suspend !== null &&
    listThreadIdsWithHostOfflineQueueWaits(deps.db, hostId).length === 0 &&
    !machineHasOpenTerminal(deps.db, hostId)
  ) {
    if (idleSince !== null && now >= idleSince + idleSuspendMs) {
      await maintainMachine(deps, hostId, () => suspendMachine(deps, hostId));
      return;
    }
  }
  if (row.phase !== "retiring" || row.retireAt === null || row.retireAt > now) {
    return;
  }
  const suspending = operations(suspendOperations, deps.db).get(hostId);
  const resuming = operations(resumeOperations, deps.db).get(hostId);
  await Promise.all([
    suspending?.done.catch(() => {}),
    resuming?.done.catch(() => {}),
  ]);
  row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.destroyedAt !== null ||
    row.phase !== "retiring" ||
    row.retireAt === null ||
    row.retireAt > Date.now()
  ) {
    return;
  }
  if (row.removalStartedAt === null && machineHasLiveThreads(deps.db, hostId)) {
    updateHost(deps.db, deps.hub, hostId, {
      phase: row.suspendedAt === null ? "active" : "suspended",
      retireAt: null,
      teardownMessage: null,
      teardownStatus: null,
    });
    return;
  }
  const environments = listEnvironments(deps.db, { hostId }).filter(
    (environment) =>
      environment.status !== "destroyed" ||
      environment.teardownStatus !== "removed",
  );
  if (
    environments.some((environment) => environment.providerOwnsPath) &&
    row.suspendedAt !== null
  ) {
    await resumeRetiringMachine(deps, hostId);
    row = getHost(deps.db, hostId);
    if (row === null || row.phase !== "retiring") return;
  }
  let pendingEnvironment = false;
  for (const environment of environments) {
    requestEnvironmentRemoval(deps, environment.id);
    await sweepProviderEnvironment(deps, environment.id);
    const current = listEnvironments(deps.db, {
      hostId,
      limit: 1,
      statuses: ["provisioning", "ready", "error"],
    });
    if (current.length > 0) pendingEnvironment = true;
  }
  if (pendingEnvironment) return;
  if (
    row.teardownStatus === "failed" &&
    row.retireAt !== null &&
    row.retireAt > now
  ) {
    return;
  }
  await removeMachine(deps, hostId);
}

export async function sweepMachineLifecycles(
  deps: Deps,
  options?: { background: true },
): Promise<void> {
  for (const launch of listMachineLaunchesByPhase(deps.db, "creating")) {
    const record = getMachineProvider(launch.providerId);
    if (record !== undefined) startCreate(deps, record, launch);
  }
  const pending: Promise<void>[] = [];
  for (const launch of listMachineLaunchesByPhase(deps.db, "failed")) {
    if (
      launch.failure === "transient" &&
      launch.transientFailures <= TRANSIENT_RETRY_LIMIT &&
      !launch.cancelPending
    ) {
      const record = getMachineProvider(launch.providerId);
      if (record !== undefined)
        askMachineLaunch(deps, {
          key: launch.key,
          record,
          projectId: launch.projectId,
          inputs: launch.inputs,
        });
      continue;
    }
    if (
      (launch.failure === "terminal" ||
        launch.transientFailures > TRANSIENT_RETRY_LIMIT) &&
      !launch.cleanupResourceRemoved
    ) {
      pending.push(
        cancelMachineLaunch(deps, launch.key, true).catch((error: unknown) => {
          deps.logger.warn(
            { key: launch.key, error: errorMessage(error) },
            "Failed machine launch cleanup will retry",
          );
        }),
      );
    } else if (launch.cancelPending) {
      pending.push(
        cancelMachineLaunch(deps, launch.key, true).catch((error: unknown) => {
          deps.logger.warn(
            { key: launch.key, error: errorMessage(error) },
            "Failed machine access cleanup will retry",
          );
        }),
      );
    }
  }
  for (const launch of listMachineLaunchesByPhase(deps.db, "cancelled")) {
    if (launch.cancelPending) {
      pending.push(
        cancelMachineLaunch(deps, launch.key).catch((error: unknown) => {
          deps.logger.warn(
            { key: launch.key, error: errorMessage(error) },
            "Machine launch cancellation will retry",
          );
        }),
      );
    }
  }
  for (const record of listMachineProviders()) {
    for (const machine of listProviderMachines(deps.db, record.provider.id)) {
      const sweeping = runTrackedOperation({
        map: operations(machineSweepOperations, deps.db),
        key: machine.id,
        run: async () => sweepProviderMachine(deps, machine.id),
      }).done;
      const settled = sweeping.catch((error: unknown) => {
        const current = getHost(deps.db, machine.id);
        if (current !== null && current.destroyedAt === null) {
          updateHost(deps.db, deps.hub, machine.id, {
            teardownAttempt: current.teardownAttempt + 1,
            teardownStatus: "failed",
            teardownMessage: errorMessage(error),
            ...(current.phase === "retiring"
              ? {
                  retireAt: Date.now() + 60_000,
                }
              : {}),
          });
        }
        deps.logger.warn(
          { hostId: machine.id, error: errorMessage(error) },
          "Machine lifecycle sweep will retry",
        );
      });
      if (options?.background !== true) pending.push(settled);
    }
  }
  await Promise.all(pending);
}

export async function getMachineProviderDetails(
  deps: Deps,
  hostId: string,
  signal: AbortSignal,
) {
  const row = getHost(deps.db, hostId);
  if (row === null || row.destroyedAt !== null)
    throw new ApiError(404, "host_not_found", "Host not found");
  const provider =
    row.machineProviderId === null
      ? null
      : getMachineProvider(row.machineProviderId)?.provider;
  if (!provider?.experimental_details || row.resource === null) return null;
  return z
    .object({ summary: z.string().max(2000), values: jsonValueSchema })
    .strict()
    .parse(
      await provider.experimental_details({
        hostId,
        resource: row.resource,
        signal,
      }),
    );
}
