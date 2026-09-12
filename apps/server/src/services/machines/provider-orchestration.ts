import { withHostCleanup } from "../hosts/cleanup-context.js";
import { requestQueuedMachineReadiness } from "../threads/queued-message-dispatch.js";
import { and, desc, eq } from "drizzle-orm";
import { createHostId, hostDaemonSessions, hosts } from "@bb/db";
import { handleHostRemoved } from "../../internal/session-owner-side-effects.js";
import type { WorkSessionDeps } from "../../types.js";
import { maintainMachine } from "./lifecycle.js";
import { serverAccess } from "./server-access.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  deleteProjectSource,
  getHost,
  getNonDestroyedHostByLaunchKey,
  listEnvironments,
  listProjectSourcesByHost,
  listProviderMachines,
  listThreadIdsWithHostOfflineQueueWaits,
  markHostEnvironmentsDestroyed,
  machineHasLiveThreadLaunch,
  machineHasStartingThreadLaunch,
  machineHasProvisioningEnvironment,
  machineHasLiveThreads,
  machineHasPendingThreads,
  updateHost,
} from "@bb/db";
import { jsonValueSchema, type Host, type JsonValue } from "@bb/domain";
import type {
  PluginMachineProviderCreateResult,
  PluginMachineProviderResource,
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
import {
  requestEnvironmentRemoval,
  sweepProviderEnvironment,
} from "../environments/environment-engine.js";
import { hasPendingProjectSourceSetupOnHost } from "../projects/project-source-setup.js";
import { machineProviderUnavailableReason } from "./provider-availability.js";
import { errorMessage } from "../lib/error-log-fields.js";
import { perDbRegistry } from "../lib/per-db-registry.js";

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

const resourceSchema = jsonValueSchema
  .refine(
    (value): value is PluginMachineProviderResource => value !== null,
    "Allocated machine resource must not be null",
  )
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value)) <= 16_384,
    "Resource exceeds 16 KiB",
  );
const createResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("created"),
      name: z.string().trim().min(1).max(200),
      resource: resourceSchema,
    })
    .strict(),
  z
    .object({ status: z.literal("failed"), message: z.string().min(1) })
    .strict(),
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
const suspendOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const resumeOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const removeOperations = new WeakMap<object, Map<string, ActiveOperation>>();
const machineSweepOperations = new WeakMap<
  object,
  Map<string, ActiveOperation>
>();

const MACHINE_CREATE_FAILURE_CLEANUP_GRACE_MS = 30_000;

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

function deleteMachineProjectSources(
  deps: MachineLifecycleDeps,
  hostId: string,
): void {
  for (const source of listProjectSourcesByHost(deps.db, hostId)) {
    deleteProjectSource(deps.db, deps.hub, source.id);
  }
}

type MachineHostRow = NonNullable<ReturnType<typeof getHost>>;

function createOwns(
  current: ReturnType<typeof getHost>,
  owner: MachineHostRow,
): current is MachineHostRow {
  return (
    current !== null &&
    current.destroyedAt === null &&
    current.id === owner.id &&
    current.attempt === owner.attempt &&
    current.machineProviderId === owner.machineProviderId &&
    current.machineOperationId === owner.machineOperationId &&
    (current.phase === "creating" || current.phase === "removing")
  );
}

function createReporter(
  deps: Deps,
  owner: MachineHostRow,
): PluginMachineProviderProgress {
  return {
    step: (text) => {
      const current = getHost(deps.db, owner.id);
      if (!createOwns(current, owner) || current.phase !== "creating") return;
      updateHost(deps.db, deps.hub, owner.id, {
        statusMessage: text.slice(0, 500),
      });
      deps.hub.notifyHost(owner.id, ["host-connected"]);
    },
    log: (text) => {
      const current = getHost(deps.db, owner.id);
      if (!createOwns(current, owner) || current.phase !== "creating") return;
      updateHost(deps.db, deps.hub, owner.id, {
        pendingLog: (
          current.pendingLog + (text.endsWith("\n") ? text : `${text}\n`)
        ).slice(-16_384),
      });
      deps.hub.notifyHost(owner.id, ["host-connected"]);
    },
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
        statusMessage: text.slice(0, 500),
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
  host: MachineHostRow,
  deps: Deps,
  signal: AbortSignal,
): Promise<PluginMachineProviderCreateResult> {
  const invocation = await invokeMachineProvider(record, "machine create", () =>
    record.provider.create({
      inputs: host.inputs,
      key: host.launchKey!,
      attempt: host.attempt,
      checkpoint: async (resource) => {
        const parsed = resourceSchema.parse(resource);
        const current = getHost(deps.db, host.id);
        if (!createOwns(current, host))
          throw new Error(
            "Machine creation attempt no longer owns this resource",
          );
        updateHost(deps.db, deps.hub, host.id, { resource: parsed });
      },
      report: createReporter(deps, host),
      signal,
    }),
  );
  if (!invocation.ok) throw new Error(invocation.error);
  return createResultSchema.parse(invocation.value);
}

async function removeResource(
  deps: Deps,
  record: PluginMachineProviderRecord,
  args: {
    hostId: string;
    resource: PluginMachineProviderResource;
    signal: AbortSignal;
  },
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
  host: MachineHostRow,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await invokeCreate(record, host, deps, signal);
    if (result.status === "failed") {
      const current = getHost(deps.db, host.id);
      if (createOwns(current, host)) {
        updateHost(deps.db, deps.hub, host.id, {
          phase: "removing",
          removeRetryAt: Date.now() + MACHINE_CREATE_FAILURE_CLEANUP_GRACE_MS,
          statusMessage: result.message,
          teardownStatus: "failed",
        });
      }
      return;
    }
    const current = getHost(deps.db, host.id);
    if (!createOwns(current, host)) {
      await removeResource(deps, record, {
        hostId: host.id,
        resource: result.resource,
        signal: new AbortController().signal,
      });
      return;
    }
    if (current.phase === "removing") {
      updateHost(deps.db, deps.hub, host.id, {
        resource: result.resource,
        removeRetryAt: Date.now(),
      });
      return;
    }
    updateHost(deps.db, deps.hub, host.id, {
      name: result.name,
      phase: "active",
      machineOperationId: null,
      resource: result.resource,
      inputs: null,
      pendingLog: "",
      removeRetryAt: null,
      suspendedAt: null,
      teardownAttempt: 0,
      statusMessage: null,
      teardownStatus: null,
    });
    deps.hub.notifyHost(host.id, ["host-connected"]);
  } catch (error) {
    const current = getHost(deps.db, host.id);
    if (signal.aborted && current?.phase === "removing") return;
    if (createOwns(current, host)) {
      updateHost(deps.db, deps.hub, host.id, {
        phase: "removing",
        removeRetryAt: Date.now() + MACHINE_CREATE_FAILURE_CLEANUP_GRACE_MS,
        statusMessage: `The "${record.provider.id}" machine provider (plugin "${record.pluginId}") failed: ${errorMessage(error)}`,
        teardownStatus: "failed",
      });
    }
  }
}

function startCreate(
  deps: Deps,
  record: PluginMachineProviderRecord,
  host: MachineHostRow,
): ActiveOperation {
  const operation = runTrackedOperation({
    map: perDbRegistry(createOperations, deps.db),
    key: host.id,
    run: (signal) => runCreate(deps, record, host, signal),
  });
  void operation.done
    .then(async () => {
      await sweepProviderMachine(deps, host.id);
    })
    .catch((error: unknown) => {
      deps.logger.warn(
        { hostId: host.id, error: errorMessage(error) },
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
  const invocation = await invokeMachineProvider(
    record,
    `"${record.provider.id}" machine provider inputs`,
    async () => schema["~standard"].validate(inputs ?? {}),
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
  const unavailableReason = await machineProviderUnavailableReason(record);
  if (unavailableReason !== null) {
    throw new ApiError(409, "machine_provider_rejected", unavailableReason);
  }
  const inputs = await parseMachineProviderInputs(record, args.inputs);
  if (record.provider.validate !== null) {
    const invocation = await invokeMachineProvider(
      record,
      `"${record.provider.id}" machine provider validate`,
      () =>
        decideWithinBox(
          () => Promise.resolve(record.provider.validate?.({ inputs })),
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
  | { action: "reject"; message: string; log: string }
  | { action: "ready"; host: Host; log: string };

export function askMachineLaunch(
  deps: Deps,
  args: {
    key: string;
    lifetime: "thread" | "standalone";
    record: PluginMachineProviderRecord;
    inputs: JsonValue | null;
  },
): MachineLaunchDecision {
  const now = Date.now();
  let row = getNonDestroyedHostByLaunchKey(deps.db, args.key);
  if (
    row !== null &&
    (row.machineProviderId !== args.record.provider.id ||
      (row.phase === "creating" &&
        JSON.stringify(row.inputs) !== JSON.stringify(args.inputs)))
  ) {
    throw new ApiError(
      409,
      "machine_launch_key_conflict",
      `Machine launch key "${args.key}" is already in use`,
    );
  }
  if (row !== null && row.phase === "removing") {
    const decision: MachineLaunchDecision = {
      action: "reject",
      message: row.statusMessage ?? "Machine creation was cancelled",
      log: takeCreateLog(deps, row),
    };
    if (
      row.teardownAttempt === 0 &&
      row.teardownStatus === "failed" &&
      row.removeRetryAt !== null &&
      row.removeRetryAt > now
    ) {
      const hostId = row.id;
      updateHost(deps.db, deps.hub, hostId, { removeRetryAt: now });
      void sweepProviderMachine(deps, hostId).catch((error: unknown) => {
        deps.logger.warn(
          { hostId, error: errorMessage(error) },
          "Machine creation cleanup failed",
        );
      });
    }
    return decision;
  }
  if (row === null) {
    const id = createHostId();
    const attempt =
      (deps.db
        .select({ attempt: hosts.attempt })
        .from(hosts)
        .where(eq(hosts.launchKey, args.key))
        .orderBy(desc(hosts.attempt))
        .limit(1)
        .get()?.attempt ?? 0) + 1;
    const suffix = id.replace(/[^a-z0-9]/giu, "").slice(-6);
    const operationId = `${args.record.pluginId}:${randomUUID()}`;
    deps.db
      .insert(hosts)
      .values({
        id,
        name: `${args.record.provider.displayName} ${suffix}`,
        type:
          args.lifetime === "thread" && args.record.provider.ephemeral
            ? "ephemeral"
            : "persistent",
        machineProviderId: args.record.provider.id,
        machineOperationId: operationId,
        launchKey: args.key,
        inputs: args.inputs,
        attempt,
        phase: "creating",
        resource: null,
        statusMessage: `Creating ${args.record.provider.displayName}…`,
        pendingLog: "",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    deps.hub.notifyHost(id, ["host-connected"]);
    row = getHost(deps.db, id)!;
    startCreate(deps, args.record, row);
  } else if (row.phase === "creating") {
    startCreate(deps, args.record, row);
  } else {
    return {
      action: "ready",
      host: machineHostResponse(row, deps),
      log: takeCreateLog(deps, row),
    };
  }
  return {
    action: "wait",
    reason: row.statusMessage ?? "Creating machine…",
    sendAt: now + 1_000,
    log: takeCreateLog(deps, row),
  };
}

function takeCreateLog(deps: Deps, row: MachineHostRow): string {
  const log = row.pendingLog;
  if (log.length > 0) {
    updateHost(deps.db, deps.hub, row.id, { pendingLog: "" });
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
    type: row.type,
    status: deps.hub.hasDaemonForHost(row.id) ? "connected" : "disconnected",
    machineProviderId: row.machineProviderId,
    lifecycle: {
      phase: row.phase,
      suspendedAt: row.suspendedAt,
      message: row.statusMessage,
      pendingLog: row.pendingLog,
      teardown:
        row.teardownStatus === null
          ? null
          : {
              status: row.teardownStatus,
              attempt: row.teardownAttempt,
            },
    },
    maxPermissionMode: row.maxPermissionMode,
    lastSeenAt: row.lastSeenAt,
    lastRejectedProtocolVersion: row.lastRejectedProtocolVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function submitMachine(
  deps: Deps,
  args: {
    key?: string;
    machineProviderId: string;
    inputs: JsonValue | null;
  },
): Promise<Host> {
  const key = args.key ?? `machine-${randomUUID()}`;
  const prepared = await prepareMachineProviderSelection(deps, args);
  const decision = askMachineLaunch(deps, {
    key,
    lifetime: "standalone",
    record: prepared.record,
    inputs: prepared.inputs,
  });
  if (decision.action === "reject")
    throw new ApiError(409, "machine_provider_rejected", decision.message);
  const host = getNonDestroyedHostByLaunchKey(deps.db, key);
  if (host === null)
    throw new ApiError(409, "machine_provider_rejected", "Machine was removed");
  return machineHostResponse(host, deps);
}

export async function removeCreatingMachine(
  deps: Deps,
  launchKey: string,
): Promise<void> {
  const host = getNonDestroyedHostByLaunchKey(deps.db, launchKey);
  if (host?.phase !== "creating") return;
  requestMachineRemoval(deps, host.id);
  await sweepProviderMachine(deps, host.id);
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
    current.machineProviderId === providerId &&
    current.machineOperationId === operationId &&
    operationId.startsWith(`${getMachineProvider(providerId)?.pluginId}:`) &&
    (Array.isArray(phase)
      ? phase.includes(current.phase)
      : current.phase === phase)
  );
}

async function suspendMachine(
  deps: Deps,
  hostId: string,
  coordinateMaintenance = false,
): Promise<void> {
  const daemonShutdownTimeoutMs = 30_000;
  const removing = perDbRegistry(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done.catch(() => {});
    return;
  }
  const resuming = perDbRegistry(resumeOperations, deps.db).get(hostId);
  if (resuming !== undefined) {
    await resuming.done.catch(() => {});
  }
  const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
  if (suspending !== undefined) {
    if (coordinateMaintenance)
      throw new ApiError(
        409,
        "machine_maintenance",
        "Machine already has a lifecycle operation or is waiting for retry.",
      );
    await suspending.done;
    return;
  }
  const row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    (row.phase !== "active" &&
      row.phase !== "suspending" &&
      !(row.phase === "removing" && row.suspendedAt === null))
  ) {
    return;
  }
  const record = getMachineProvider(row.machineProviderId);
  if (record === undefined || record.provider.suspend === null) return;
  if (row.resource === null) {
    throw new Error(`Machine "${hostId}" has no provider resource`);
  }
  const operationId = `${record.pluginId}:${randomUUID()}`;
  const suspend = record.provider.suspend;
  const resource = row.resource;
  const removalRequested = row.phase === "removing";
  const operation = runTrackedOperation({
    map: perDbRegistry(suspendOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      const run = async () => {
        updateHost(deps.db, deps.hub, hostId, {
          phase: "suspending",
          machineOperationId: operationId,
          ...(coordinateMaintenance ? {} : { statusMessage: null }),
          teardownStatus: null,
        });
        const daemonSessionId = deps.hub.getDaemonSessionIdForHost(hostId);
        if (daemonSessionId !== null) {
          deps.hub.requestDaemonShutdown(daemonSessionId);
          const closed = await deps.hub.waitForDaemonSessionClose(
            daemonSessionId,
            daemonShutdownTimeoutMs,
          );
          if (!closed || deps.hub.hasDaemonForHost(hostId)) {
            if (!coordinateMaintenance) {
              updateHost(deps.db, deps.hub, hostId, {
                phase: "active",
                machineOperationId: null,
              });
            }
            throw new Error(
              `Machine "${hostId}" daemon did not shut down cleanly within ${daemonShutdownTimeoutMs}ms; suspend was cancelled`,
            );
          }
        }
        updateHost(deps.db, deps.hub, hostId, { suspendedAt: Date.now() });
        const invocation = await invokeMachineProvider(
          record,
          "machine suspend",
          () =>
            suspend({
              hostId,
              resource,
              report: lifecycleReporter(deps, hostId),
              signal,
              checkpoint: async (checkpoint) => {
                const parsed = resourceSchema.parse(checkpoint);
                const current = getHost(deps.db, hostId);
                if (
                  !lifecycleOwns(current, record.provider.id, operationId, [
                    "suspending",
                    "removing",
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
        if (!invocation.ok) {
          throw new Error(invocation.error);
        }
        const result = resourceResultSchema.parse(invocation.value);
        const current = getHost(deps.db, hostId);
        if (
          !lifecycleOwns(current, record.provider.id, operationId, [
            "suspending",
            "removing",
          ])
        ) {
          return;
        }
        updateHost(deps.db, deps.hub, hostId, {
          phase:
            removalRequested || current.phase === "removing"
              ? "removing"
              : "suspended",
          resource: result.resource,
          suspendedAt: Date.now(),
          statusMessage: null,
          teardownStatus: null,
        });
        deps.hub.notifyHost(hostId, ["host-disconnected"]);
      };
      if (coordinateMaintenance) {
        await maintainMachine(deps, hostId, operationId, run);
      } else {
        await run();
      }
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

function assertMachineProvisioningComplete(deps: Deps, hostId: string): void {
  if (
    !hasPendingProjectSourceSetupOnHost(deps.db, hostId) &&
    !machineHasProvisioningEnvironment(deps.db, hostId) &&
    !machineHasStartingThreadLaunch(deps.db, hostId)
  )
    return;
  throw new ApiError(
    409,
    "machine_busy",
    "Wait for thread provisioning to finish before suspending this machine.",
  );
}

function requireActiveSuspendableMachine(deps: Deps, hostId: string): void {
  const row = requireSuspendableMachine(deps, hostId);
  if (row.phase !== "active" && row.phase !== "suspending") {
    throw new ApiError(
      409,
      "machine_not_active",
      "Only an active machine can be suspended",
    );
  }
  assertMachineProvisioningComplete(deps, hostId);
}

export async function requestMachineSuspension(
  deps: Deps,
  hostId: string,
): Promise<void> {
  requireActiveSuspendableMachine(deps, hostId);
  await suspendMachine(deps, hostId, true);
  if (listThreadIdsWithHostOfflineQueueWaits(deps.db, hostId).length > 0) {
    requestQueuedMachineReadiness(deps, hostId);
  }
}

export function startMachineSuspension(deps: Deps, hostId: string): void {
  requireActiveSuspendableMachine(deps, hostId);
  void requestMachineSuspension(deps, hostId).catch((error: unknown) => {
    deps.logger.warn(
      { hostId, error: errorMessage(error) },
      "Requested machine suspension will retry in the lifecycle sweep",
    );
  });
}

export async function waitForMachineMaintenance(
  deps: MachineLifecycleDeps,
  hostId: string,
): Promise<void> {
  const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
  if (suspending !== undefined) {
    await suspending.done;
  }
}

export function startMachineResume(deps: Deps, hostId: string): void {
  const row = requireSuspendableMachine(deps, hostId);
  if (
    row.phase !== "active" &&
    row.phase !== "suspended" &&
    row.phase !== "suspending" &&
    row.phase !== "resuming"
  ) {
    throw new ApiError(
      409,
      "machine_not_suspended",
      "Only an active or suspended machine can be resumed",
    );
  }
  void resumeMachine(deps, hostId).catch((error: unknown) => {
    deps.logger.warn(
      { hostId, error: errorMessage(error) },
      "Requested machine resume will retry in the lifecycle sweep",
    );
  });
}

export async function resumeMachine(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  const removing = perDbRegistry(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done.catch(() => {});
    return;
  }
  const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
  if (suspending !== undefined) {
    await suspending.done.catch(() => {});
  }
  await resumeMachineWithIntent(deps, hostId, false);
}

async function resumeMachineWithIntent(
  deps: WorkSessionDeps,
  hostId: string,
  preserveRemoval: boolean,
): Promise<void> {
  let row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    (row.phase === "removing" && !preserveRemoval)
  )
    return;
  if (
    row.phase !== "suspended" &&
    row.phase !== "suspending" &&
    row.phase !== "resuming" &&
    !(row.phase === "removing" && row.suspendedAt !== null && preserveRemoval)
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
  const operationId = `${record.pluginId}:${randomUUID()}`;
  const initialPhase = row.phase;
  const resumePhase = preserveRemoval ? "removing" : "resuming";
  const resume = record.provider.resume;
  const resource = row.resource;
  const operation = runTrackedOperation({
    map: perDbRegistry(resumeOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      updateHost(deps.db, deps.hub, hostId, {
        machineOperationId: operationId,
        phase: resumePhase,
        statusMessage: "Resuming…",
      });
      deps.hub.notifyHost(hostId, ["host-disconnected"]);
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
                !lifecycleOwns(
                  current,
                  record.provider.id,
                  operationId,
                  resumePhase,
                )
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
      if (
        !lifecycleOwns(current, record.provider.id, operationId, resumePhase)
      ) {
        return;
      }
      const keepRemoving = current.phase === "removing";
      updateHost(deps.db, deps.hub, hostId, {
        phase: keepRemoving ? "removing" : "active",
        resource: result.resource,
        suspendedAt: null,
        removeRetryAt: keepRemoving ? current.removeRetryAt : null,
        statusMessage: null,
        teardownStatus: null,
      });
      deps.hub.notifyHost(hostId, ["host-connected"]);
    },
  });
  try {
    await operation.done;
    updateHost(deps.db, deps.hub, hostId, {
      statusMessage: null,
      suspendRetryAt: null,
    });
  } catch (error) {
    const current = getHost(deps.db, hostId);
    const ownsResume = lifecycleOwns(
      current,
      record.provider.id,
      operationId,
      resumePhase,
    );
    updateHost(deps.db, deps.hub, hostId, {
      ...(ownsResume && !preserveRemoval
        ? {
            phase: initialPhase === "suspending" ? "suspending" : "suspended",
          }
        : {}),
      statusMessage: `Machine resume failed: ${errorMessage(error)}`,
      suspendRetryAt: Date.now() + 10_000,
    });
    deps.hub.notifyHost(hostId, ["host-disconnected"]);
    throw error;
  }
}

async function resumeRemovingMachine(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  await resumeMachineWithIntent(deps, hostId, true);
}

export function requestMachineRemoval(deps: Deps, hostId: string): boolean {
  const row = getHost(deps.db, hostId);
  if (row === null || row.destroyedAt !== null) return false;
  if (row.machineProviderId === null) return false;
  if (row.phase !== "creating" && machineHasLiveThreads(deps.db, hostId))
    return false;
  updateHost(deps.db, deps.hub, hostId, {
    phase: "removing",
    machineOperationId:
      row.phase === "suspending" || row.phase === "creating"
        ? row.machineOperationId
        : null,
    removeRetryAt: Date.now(),
    teardownStatus: null,
    statusMessage: null,
  });
  deps.hub.notifyHost(hostId, ["host-disconnected"]);
  return true;
}

export function requestAutomaticMachineRemoval(
  deps: Deps,
  hostId: string,
): boolean {
  const row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    row.destroyedAt !== null ||
    row.phase === "creating" ||
    row.phase === "removing"
  ) {
    return false;
  }
  if (row.type !== "ephemeral") return false;
  if (
    machineHasPendingThreads(deps.db, hostId) ||
    machineHasLiveThreadLaunch(deps.db, hostId) ||
    machineHasLiveThreads(deps.db, hostId)
  ) {
    return false;
  }
  return requestMachineRemoval(deps, hostId);
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
    row.phase !== "removing" ||
    row.teardownStatus !== "failed"
  ) {
    throw new ApiError(
      409,
      "machine_cleanup_not_failed",
      "Cleanup can only be retried after machine teardown fails",
    );
  }
  updateHost(deps.db, deps.hub, hostId, { removeRetryAt: Date.now() });
  await sweepProviderMachine(deps, hostId);
}

async function removeMachine(deps: Deps, hostId: string): Promise<void> {
  let removing = perDbRegistry(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done;
    return;
  }
  const creating = perDbRegistry(createOperations, deps.db).get(hostId);
  if (creating !== undefined) {
    creating.controller.abort();
    await creating.done.catch(() => {});
  }
  const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
  const resuming = perDbRegistry(resumeOperations, deps.db).get(hostId);
  await Promise.all([
    suspending?.done.catch(() => {}),
    resuming?.done.catch(() => {}),
  ]);
  removing = perDbRegistry(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done;
    return;
  }
  const row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.machineProviderId === null ||
    row.destroyedAt !== null ||
    row.phase !== "removing"
  ) {
    return;
  }
  const record = getMachineProvider(row.machineProviderId);
  if (record === undefined) return;
  const resource = row.resource;
  const operationId = `${record.pluginId}:${randomUUID()}`;
  const attempt = row.teardownAttempt + 1;
  const creationFailureMessage =
    row.teardownAttempt === 0 && row.teardownStatus === "failed"
      ? row.statusMessage
      : null;
  updateHost(deps.db, deps.hub, hostId, {
    machineOperationId: operationId,
    teardownAttempt: attempt,
    teardownStatus: "running",
    statusMessage: creationFailureMessage,
  });
  const operation = runTrackedOperation({
    map: perDbRegistry(removeOperations, deps.db),
    key: hostId,
    run: async (signal) => {
      try {
        if (resource === null) {
          const invocation = await invokeMachineProvider(
            record,
            "machine cleanup reconciliation",
            () =>
              record.provider.reconcileCleanup({
                key: row.launchKey ?? hostId,
                report: lifecycleReporter(deps, hostId),
                signal,
              }),
          );
          if (!invocation.ok) throw new Error(invocation.error);
          const result = removeResultSchema.parse(invocation.value);
          if (result.status === "failed") throw new Error(result.message);
        } else {
          await removeResource(deps, record, { hostId, resource, signal });
        }
        const current = getHost(deps.db, hostId);
        if (
          !lifecycleOwns(current, record.provider.id, operationId, "removing")
        )
          return;
        if (current.type === "ephemeral") {
          markHostEnvironmentsDestroyed(deps.db, deps.hub, hostId);
        }
        await deps.machineAuth.revokeHostEnrollKeys({ hostId });
        await serverAccess.release(deps, { key: hostId, hostId });
        deleteMachineProjectSources(deps, hostId);
        await deps.machineAuth.revokeHostAuthKeys({ hostId });
        expireMachineSessions(deps, hostId);
        const latest = getHost(deps.db, hostId);
        if (!lifecycleOwns(latest, record.provider.id, operationId, "removing"))
          return;
        updateHost(deps.db, deps.hub, hostId, {
          destroyedAt: Date.now(),
          phase: "destroyed",
          resource: null,
          removeRetryAt: null,
          suspendedAt: null,
          teardownStatus: "removed",
          statusMessage: creationFailureMessage,
        });
        deps.hub.notifyHost(hostId, ["host-disconnected"]);
      } catch (error) {
        const current = getHost(deps.db, hostId);
        if (
          !lifecycleOwns(current, record.provider.id, operationId, "removing")
        )
          return;
        updateHost(deps.db, deps.hub, hostId, {
          teardownStatus: "failed",
          statusMessage: errorMessage(error),
          removeRetryAt: Date.now() + 60_000,
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
  requestAutomaticMachineRemoval(deps, hostId);
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
  if (row.phase === "creating") {
    await startCreate(deps, record, row).done;
    return;
  }
  if (row.phase === "resuming") {
    await resumeMachine(deps, hostId);
    return;
  }
  if (
    row.phase !== "removing" &&
    row.suspendedAt !== null &&
    listThreadIdsWithHostOfflineQueueWaits(deps.db, hostId).length > 0
  ) {
    await resumeMachine(deps, hostId);
    return;
  }
  if (row.phase === "suspending") {
    const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
    if (suspending !== undefined) {
      await suspending.done;
      return;
    }
    updateHost(deps.db, deps.hub, hostId, {
      statusMessage:
        row.suspendedAt !== null
          ? null
          : "Machine suspension was interrupted; recovery will use the last persisted provider resource.",
      suspendRetryAt: row.suspendedAt !== null ? null : Date.now(),
    });
    await resumeMachine(deps, hostId);
    return;
  }
  const now = Date.now();
  const removing = perDbRegistry(removeOperations, deps.db).get(hostId);
  if (removing !== undefined) {
    await removing.done;
    return;
  }
  if (perDbRegistry(resumeOperations, deps.db).has(hostId)) return;
  if (
    row.phase !== "removing" ||
    row.removeRetryAt === null ||
    row.removeRetryAt > now
  ) {
    return;
  }
  const suspending = perDbRegistry(suspendOperations, deps.db).get(hostId);
  const resuming = perDbRegistry(resumeOperations, deps.db).get(hostId);
  await Promise.all([
    suspending?.done.catch(() => {}),
    resuming?.done.catch(() => {}),
  ]);
  row = getHost(deps.db, hostId);
  if (
    row === null ||
    row.destroyedAt !== null ||
    row.phase !== "removing" ||
    row.removeRetryAt === null ||
    row.removeRetryAt > Date.now()
  ) {
    return;
  }
  const environments = listEnvironments(deps.db, { hostId }).filter(
    (environment) =>
      environment.status !== "destroyed" ||
      environment.teardownStatus !== "removed",
  );
  if (row.type === "persistent") {
    if (
      environments.some((environment) => environment.providerOwnsPath) &&
      row.suspendedAt !== null
    ) {
      await withHostCleanup(deps, hostId, () =>
        resumeRemovingMachine(deps, hostId),
      );
      row = getHost(deps.db, hostId);
      if (row === null || row.phase !== "removing") return;
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
  }
  if (
    row.teardownStatus === "failed" &&
    row.removeRetryAt !== null &&
    row.removeRetryAt > now
  ) {
    return;
  }
  await removeMachine(deps, hostId);
}

export async function sweepMachineLifecycles(
  deps: Deps,
  options?: { background: true },
): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const record of listMachineProviders()) {
    for (const machine of listProviderMachines(deps.db, record.provider.id)) {
      requestAutomaticMachineRemoval(deps, machine.id);
      const sweeping = runTrackedOperation({
        map: perDbRegistry(machineSweepOperations, deps.db),
        key: machine.id,
        run: async () => sweepProviderMachine(deps, machine.id),
      }).done;
      const settled = sweeping.catch((error: unknown) => {
        const current = getHost(deps.db, machine.id);
        if (current !== null && current.destroyedAt === null) {
          updateHost(deps.db, deps.hub, machine.id, {
            teardownAttempt: current.teardownAttempt + 1,
            teardownStatus: "failed",
            statusMessage: errorMessage(error),
            ...(current.phase === "removing"
              ? {
                  removeRetryAt: Date.now() + 60_000,
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
