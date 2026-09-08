import { cancelPendingEnvironmentHook } from "../environments/environment-hooks.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  environmentHookOperations,
  environments,
  getHost,
  hosts,
  machineHasLiveThreads,
  machineLifecycles,
  terminalSessions,
  threads,
  updateHost,
} from "@bb/db";
import { jsonValueSchema } from "@bb/domain";
import type {
  experimental_HostLifecycleRequest,
  experimental_HostLifecycleResponse,
} from "@bb/server-contract";
import type {
  WorkSessionDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  getMachineProvider,
  invokeMachineProvider,
} from "../plugins/plugin-machine-provider-registry.js";
import { appendSystemErrorEvent } from "../threads/thread-events.js";
import { threadScope } from "@bb/domain";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

const observationSchema = z
  .object({
    state: z.enum(["running", "suspended", "missing", "unknown"]),
    expiresAt: z.number().finite().nullable(),
    resource: jsonValueSchema,
  })
  .strict();
const durationSchema = z.number().int().nonnegative().nullable();
const policySchema = z
  .object({
    idleSuspendMs: durationSchema,
    retireAfterMs: durationSchema,
    deadlineLeadMs: durationSchema,
  })
  .strict();
const LEASE_MS = 30_000;
const RETRY_MS = 10_000;
type Deps = Pick<WorkSessionDeps, "db" | "hub" | "logger">;

export function getMachineLifecycle(deps: Pick<Deps, "db">, hostId: string) {
  return deps.db
    .select()
    .from(machineLifecycles)
    .where(eq(machineLifecycles.hostId, hostId))
    .get();
}

export async function observeMachineLifecycle(
  deps: Deps,
  hostId: string,
): Promise<void> {
  const host = getHost(deps.db, hostId);
  if (
    host === null ||
    host.destroyedAt !== null ||
    host.machineProviderId === null ||
    host.resource === null
  )
    return;
  const resource = host.resource;
  const record = getMachineProvider(host.machineProviderId);
  const observe = record?.provider.experimental_observe;
  const policy = record?.provider.experimental_policy;
  if (record === undefined || observe === undefined || policy === undefined)
    return;
  deps.db
    .insert(machineLifecycles)
    .values({
      hostId,
      observedState: "unknown",
      observedAt: Date.now(),
      recoveryState: "healthy",
    })
    .onConflictDoNothing()
    .run();
  const previous = getMachineLifecycle(deps, hostId);
  if (previous?.leaseUntil != null && previous.leaseUntil > Date.now()) return;
  const result = await invokeMachineProvider(
    record,
    "machine observation",
    async () => ({
      observation: observationSchema.parse(
        await observe({
          hostId,
          resource,
          signal: AbortSignal.timeout(10_000),
        }),
      ),
      policy: policySchema.parse(await policy({ hostId, resource })),
    }),
  );
  if (!result.ok) {
    if (previous !== undefined)
      deps.db
        .update(machineLifecycles)
        .set({ message: result.error, observedState: "unknown" })
        .where(eq(machineLifecycles.hostId, hostId))
        .run();
    throw new ApiError(409, "machine_observation_failed", result.error);
  }
  const { observation, policy: effective } = result.value;
  deps.db.transaction((tx) => {
    const current = getHost(tx, hostId);
    const state = tx
      .select()
      .from(machineLifecycles)
      .where(eq(machineLifecycles.hostId, hostId))
      .get();
    if (
      current === null ||
      current.destroyedAt !== null ||
      current.machineOperationId !== host.machineOperationId ||
      JSON.stringify(current.resource) !== JSON.stringify(host.resource) ||
      (state?.leaseUntil != null && state.leaseUntil > Date.now())
    )
      return;
    const now = Date.now();
    const unusedSince = machineHasLiveThreads(tx, hostId)
      ? null
      : (state?.unusedSince ?? now);
    const retentionAt =
      state?.keep === true ||
      unusedSince === null ||
      effective.retireAfterMs === null
        ? null
        : unusedSince + effective.retireAfterMs;
    const lost =
      observation.state === "missing" && current.suspendedAt === null;
    const values = {
      observedState: observation.state,
      observedAt: now,
      expiresAt: observation.expiresAt,
      maintenanceAt:
        observation.expiresAt === null || effective.deadlineLeadMs === null
          ? null
          : observation.expiresAt - effective.deadlineLeadMs,
      ...effective,
      unusedSince,
      retentionAt,
      ...(lost
        ? {
            recoveryState: "lost-since-last-snapshot" as const,
            message:
              "Compute disappeared before preservation completed. Changes since the last successful snapshot may be lost. Explicit recovery is required.",
          }
        : {}),
    };
    tx.insert(machineLifecycles)
      .values({ hostId, recoveryState: "healthy", ...values })
      .onConflictDoUpdate({ target: machineLifecycles.hostId, set: values })
      .run();
    tx.update(hosts)
      .set({ resource: observation.resource })
      .where(eq(hosts.id, hostId))
      .run();
  });
}

export function machineLifecycleStatus(
  deps: Deps,
  hostId: string,
  input: experimental_HostLifecycleRequest,
): experimental_HostLifecycleResponse {
  const host = getHost(deps.db, hostId);
  if (host === null)
    throw new ApiError(404, "host_not_found", "Host not found");
  if (input.keep !== undefined) {
    const current = getMachineLifecycle(deps, hostId);
    if (current === undefined)
      throw new ApiError(
        409,
        "machine_lifecycle_unavailable",
        "This machine does not declare lifecycle policy",
      );
    deps.db
      .update(machineLifecycles)
      .set({
        keep: input.keep,
        retentionAt:
          input.keep ||
          current.unusedSince === null ||
          current.retireAfterMs === null
            ? null
            : current.unusedSince + current.retireAfterMs,
      })
      .where(eq(machineLifecycles.hostId, hostId))
      .run();
  }
  const state = getMachineLifecycle(deps, hostId);
  return {
    phase: host.phase,
    expiresAt: state?.expiresAt ?? null,
    maintenanceAt: state?.maintenanceAt ?? null,
    lastSnapshotAt: state?.lastSnapshotAt ?? null,
    recoveryState: state?.recoveryState ?? "healthy",
    message:
      state?.message ??
      (state?.retentionAt == null
        ? null
        : `Automatic removal is scheduled for ${new Date(state.retentionAt).toISOString()}. Use keep to retain this machine.`),
    retentionAt: state?.retentionAt ?? null,
    keep: state?.keep ?? false,
  };
}

export function assertMachineLifecycleAdmission(
  deps: Deps,
  hostId: string,
): void {
  const state = getMachineLifecycle(deps, hostId);
  if (state === undefined) return;
  if (state.recoveryState === "lost-since-last-snapshot")
    throw new ApiError(
      409,
      "machine_preservation_lost",
      state.message ?? "Machine preservation was lost",
    );
  if (
    state.leaseId !== null ||
    state.recoveryState === "draining" ||
    state.recoveryState === "saving" ||
    (state.maintenanceAt !== null &&
      state.maintenanceAt <= Date.now() &&
      state.observedState === "running")
  )
    throw new ApiError(
      409,
      "machine_maintenance",
      state.message ??
        "Machine is preserving its filesystem; dispatch will wait",
    );
  if (state.observedState === "unknown")
    throw new ApiError(
      409,
      "machine_state_unknown",
      state.message ?? "Machine state is unknown; retry observation",
    );
}

export async function maintainMachine(
  deps: LoggedPendingInteractionWorkSessionDeps,
  hostId: string,
  save: () => Promise<void>,
): Promise<void> {
  const leaseId = randomUUID();
  const claimed = deps.db.transaction((tx) => {
    const row = tx
      .select()
      .from(machineLifecycles)
      .where(eq(machineLifecycles.hostId, hostId))
      .get();
    if (
      row === undefined ||
      (row.leaseUntil !== null && row.leaseUntil > Date.now()) ||
      (row.retryAt !== null && row.retryAt > Date.now()) ||
      row.recoveryState === "lost-since-last-snapshot"
    )
      return false;
    tx.update(machineLifecycles)
      .set({
        leaseId,
        leaseUntil: Date.now() + LEASE_MS,
        recoveryState: "draining",
        message:
          "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
      })
      .where(eq(machineLifecycles.hostId, hostId))
      .run();
    return true;
  });
  if (!claimed) return;
  const owned = and(
    eq(machineLifecycles.hostId, hostId),
    eq(machineLifecycles.leaseId, leaseId),
  );
  const heartbeat = setInterval(() => {
    deps.db
      .update(machineLifecycles)
      .set({ leaseUntil: Date.now() + LEASE_MS })
      .where(owned)
      .run();
  }, 8_000);
  try {
    const state = getMachineLifecycle(deps, hostId);
    const drainMs = Math.min(
      5 * 60_000,
      state?.expiresAt == null
        ? 5 * 60_000
        : Math.max(1_000, Math.floor((state.expiresAt - Date.now()) / 3)),
    );
    await boundedDrain(async () => {
      const hooks = deps.db
        .select({ id: environmentHookOperations.id })
        .from(environmentHookOperations)
        .where(
          and(
            eq(environmentHookOperations.hostId, hostId),
            isNull(environmentHookOperations.finishedAt),
          ),
        )
        .all();
      await Promise.all(
        hooks.map((hook) => cancelPendingEnvironmentHook(deps, hook.id)),
      );
      const active = deps.db
        .select({
          id: threads.id,
          status: threads.status,
          environmentId: threads.environmentId,
        })
        .from(threads)
        .innerJoin(environments, eq(threads.environmentId, environments.id))
        .where(
          and(
            eq(environments.hostId, hostId),
            inArray(threads.status, ["active", "stopping"]),
          ),
        )
        .all();
      for (const thread of active)
        appendSystemErrorEvent(deps, {
          threadId: thread.id,
          environmentId: thread.environmentId,
          scope: threadScope(),
          code: "machine_maintenance",
          message:
            "Machine preservation is interrupting this turn. Its result is not a successful completion. Continue with a new turn after the machine resumes.",
        });
      await Promise.all(
        active.map((thread) =>
          stopThreadForCurrentState(
            deps,
            thread,
            thread.environmentId === null
              ? null
              : { id: thread.environmentId, hostId },
            { requireStopped: true },
          ),
        ),
      );
      const stillActive = deps.db
        .select({ id: threads.id })
        .from(threads)
        .innerJoin(environments, eq(threads.environmentId, environments.id))
        .where(
          and(
            eq(environments.hostId, hostId),
            inArray(threads.status, ["active", "stopping"]),
          ),
        )
        .limit(1)
        .get();
      if (stillActive !== undefined)
        throw new Error(
          "A turn did not stop; refusing to save or terminate live writers",
        );
      const terminals = deps.db
        .select({ id: terminalSessions.id })
        .from(terminalSessions)
        .where(
          and(
            eq(terminalSessions.hostId, hostId),
            inArray(terminalSessions.status, [
              "starting",
              "running",
              "disconnected",
            ]),
          ),
        )
        .all();
      await Promise.all(
        terminals.map((terminal) =>
          deps.terminalSessions.closeTerminal({
            terminalId: terminal.id,
            payload: { mode: "force", reason: "user" },
          }),
        ),
      );
    }, drainMs);
    if (getMachineLifecycle(deps, hostId)?.leaseId !== leaseId)
      throw new Error("Machine maintenance lease was replaced");
    deps.db
      .update(machineLifecycles)
      .set({
        recoveryState: "saving",
        message: "Saving the filesystem before terminating compute.",
      })
      .where(owned)
      .run();
    await save();
    deps.db
      .update(machineLifecycles)
      .set({
        recoveryState: "saved",
        message: null,
        observedState: "suspended",
        expiresAt: null,
        maintenanceAt: null,
        retryAt: null,
      })
      .where(owned)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const state = getMachineLifecycle(deps, hostId);
    const expired = state?.expiresAt != null && state.expiresAt <= Date.now();
    deps.db
      .update(machineLifecycles)
      .set({
        recoveryState: expired ? "lost-since-last-snapshot" : "recoverable",
        message: `Urgent preservation failure: ${message}. Last successful save: ${state?.lastSnapshotAt == null ? "none" : new Date(state.lastSnapshotAt).toISOString()}. ${expired ? "Changes since that save may be lost." : "Old compute is retained; preservation will retry."}`,
        retryAt: Date.now() + RETRY_MS,
      })
      .where(owned)
      .run();
    const host = getHost(deps.db, hostId);
    if (host?.phase === "suspending")
      updateHost(deps.db, deps.hub, hostId, {
        phase: host.retireAt === null ? "active" : "retiring",
      });
    throw error;
  } finally {
    clearInterval(heartbeat);
    deps.db
      .update(machineLifecycles)
      .set({ leaseId: null, leaseUntil: null })
      .where(owned)
      .run();
  }
}

export async function waitForMachineMaintenance(
  deps: Deps,
  hostId: string,
): Promise<void> {
  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    const state = getMachineLifecycle(deps, hostId);
    if (
      state === undefined ||
      state.recoveryState === "lost-since-last-snapshot" ||
      state.observedState === "unknown"
    )
      break;
    const waiting =
      state.leaseId !== null ||
      state.recoveryState === "draining" ||
      state.recoveryState === "saving" ||
      (state.maintenanceAt !== null &&
        state.maintenanceAt <= Date.now() &&
        state.observedState === "running");
    if (!waiting || Date.now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  assertMachineLifecycleAdmission(deps, hostId);
}

async function boundedDrain(
  run: () => Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Machine drain exceeded its deadline; old compute is retained",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
