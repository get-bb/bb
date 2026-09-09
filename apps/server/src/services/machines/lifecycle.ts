import { cancelPendingEnvironmentHook } from "../environments/environment-hooks.js";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  environmentHookOperations,
  environments,
  getHost,
  machineLifecycles,
  terminalSessions,
  threads,
} from "@bb/db";
import type { experimental_HostLifecycleResponse } from "@bb/server-contract";
import type {
  WorkSessionDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";

import { appendSystemErrorEvent } from "../threads/thread-events.js";
import { threadScope } from "@bb/domain";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

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

export function machineLifecycleStatus(
  deps: Deps,
  hostId: string,
): experimental_HostLifecycleResponse {
  const host = getHost(deps.db, hostId);
  if (host === null)
    throw new ApiError(404, "host_not_found", "Host not found");
  const state = getMachineLifecycle(deps, hostId);
  return {
    phase: host.phase,
    recoveryState: state?.recoveryState ?? "healthy",
    message: state?.message ?? null,
  };
}

export function assertMachineLifecycleAdmission(
  deps: Deps,
  hostId: string,
): void {
  const state = getMachineLifecycle(deps, hostId);
  if (state === undefined) return;
  if (
    state.leaseId !== null ||
    state.recoveryState === "draining" ||
    state.recoveryState === "saving"
  )
    throw new ApiError(
      409,
      "machine_maintenance",
      state.message ??
        "Machine is preserving its filesystem; dispatch will wait",
    );
}

export async function maintainMachine(
  deps: LoggedPendingInteractionWorkSessionDeps,
  hostId: string,
  save: () => Promise<void>,
): Promise<void> {
  deps.db
    .insert(machineLifecycles)
    .values({ hostId, recoveryState: "healthy" })
    .onConflictDoNothing()
    .run();
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
      (row.retryAt !== null && row.retryAt > Date.now())
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
        hooks.map((hook) =>
          cancelPendingEnvironmentHook(deps, { id: hook.id, hostId }),
        ),
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
    }, 5 * 60_000);
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
        retryAt: null,
      })
      .where(owned)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.db
      .update(machineLifecycles)
      .set({
        recoveryState: "recoverable",
        message: `Machine suspension failed: ${message}`,
        retryAt: Date.now() + RETRY_MS,
      })
      .where(owned)
      .run();
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
    if (state === undefined) break;
    const waiting =
      state.leaseId !== null ||
      state.recoveryState === "draining" ||
      state.recoveryState === "saving";
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
