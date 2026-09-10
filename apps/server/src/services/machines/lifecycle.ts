import { cancelPendingEnvironmentHook } from "../environments/environment-hooks.js";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  environmentHookOperations,
  environments,
  getHost,
  terminalSessions,
  threads,
  updateHost,
} from "@bb/db";
import type {
  WorkSessionDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";

import { appendSystemErrorEvent } from "../threads/thread-events.js";
import { threadScope } from "@bb/domain";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

const RETRY_MS = 10_000;
const preparingPauses = new WeakMap<
  WorkSessionDeps["db"],
  Map<string, { cancelled: boolean }>
>();

type Deps = Pick<WorkSessionDeps, "db" | "hub" | "logger">;

export function assertMachineLifecycleAdmission(
  deps: Deps,
  hostId: string,
): void {
  const host = getHost(deps.db, hostId);
  if (host?.phase === "suspending")
    throw new ApiError(
      409,
      "machine_maintenance",
      host.statusMessage ??
        "Machine is preserving its filesystem; dispatch will wait",
    );
}

export function cancelPreparingMachinePause(
  deps: Pick<Deps, "db">,
  hostId: string,
): void {
  const pending = preparingPauses.get(deps.db)?.get(hostId);
  if (pending !== undefined) pending.cancelled = true;
}

export function isMachineWaitingForExecution(
  deps: Pick<Deps, "db">,
  hostId: string,
): boolean {
  const host = getHost(deps.db, hostId);
  return (
    host?.suspendedAt != null ||
    host?.phase === "suspending" ||
    host?.phase === "suspended"
  );
}

export async function maintainMachine(
  deps: LoggedPendingInteractionWorkSessionDeps,
  hostId: string,
  operationId: string,
  save: () => Promise<void>,
): Promise<void> {
  const host = getHost(deps.db, hostId);
  if (host === null)
    throw new ApiError(404, "host_not_found", "Host not found");
  if (host.suspendRetryAt !== null && host.suspendRetryAt > Date.now())
    throw new ApiError(
      409,
      "machine_maintenance",
      "Machine already has a lifecycle operation or is waiting for retry.",
    );
  const pending = { cancelled: false };
  const pauses =
    preparingPauses.get(deps.db) ?? new Map<string, { cancelled: boolean }>();
  preparingPauses.set(deps.db, pauses);
  pauses.set(hostId, pending);
  const originalPhase = host.phase;
  updateHost(deps.db, deps.hub, hostId, {
    phase: "suspending",
    machineOperationId: operationId,
    statusMessage:
      "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
    suspendRetryAt: null,
  });
  deps.hub.notifyHost(hostId, ["host-disconnected"]);
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
    pauses.delete(hostId);
    if (pending.cancelled) {
      throw new ApiError(
        409,
        "machine_pause_cancelled",
        "Pause cancelled because a follow-up was sent.",
      );
    }
    updateHost(deps.db, deps.hub, hostId, {
      statusMessage: "Saving the filesystem before terminating compute.",
    });
    deps.hub.notifyHost(hostId, ["host-disconnected"]);
    await save();
    updateHost(deps.db, deps.hub, hostId, {
      statusMessage: null,
      suspendRetryAt: null,
    });
  } catch (error) {
    const cancelled =
      error instanceof ApiError &&
      error.body.code === "machine_pause_cancelled";
    const message = error instanceof Error ? error.message : String(error);
    const current = getHost(deps.db, hostId);
    const phase =
      current?.phase === "removing"
        ? current.phase
        : current !== null && current.suspendedAt !== null
          ? "suspended"
          : originalPhase === "suspending"
            ? "active"
            : originalPhase;
    updateHost(deps.db, deps.hub, hostId, {
      ...(phase === undefined ? {} : { phase }),
      statusMessage: cancelled ? null : `Machine suspension failed: ${message}`,
      suspendRetryAt: cancelled ? null : Date.now() + RETRY_MS,
    });
    deps.hub.notifyHost(hostId, ["host-disconnected"]);
    throw error;
  } finally {
    pauses.delete(hostId);
  }
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
