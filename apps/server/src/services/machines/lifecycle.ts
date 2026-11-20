import { cancelPendingEnvironmentHook } from "../environments/environment-hooks.js";
import {
  getHost,
  hostHasRunningTurnThread,
  listOpenTerminalSessionIdsOnHost,
  listRunningTurnThreadsOnHost,
  listUnfinishedEnvironmentHookOperationIdsOnHost,
  updateHost,
} from "@bb/db";
import type {
  WorkSessionDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  SERVER_MOVE_FROZEN_RETRY_MS,
  isServerMoveFrozen,
} from "../server-move/freeze-state.js";

import { appendSystemErrorEvent } from "../threads/thread-events.js";
import { threadScope } from "@bb/domain";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

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
    host?.phase === "suspended" ||
    host?.phase === "resuming"
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
  });
  deps.hub.notifyHost(hostId, ["host-disconnected"]);
  try {
    const drainDeadline = { db: deps.db, timeoutMs: 5 * 60_000 };
    await boundedDrain(async () => {
      const hookIds = listUnfinishedEnvironmentHookOperationIdsOnHost(
        deps.db,
        hostId,
      );
      await Promise.all(
        hookIds.map((id) => cancelPendingEnvironmentHook(deps, { id, hostId })),
      );
      const active = listRunningTurnThreadsOnHost(deps.db, hostId);
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
      if (hostHasRunningTurnThread(deps.db, hostId))
        throw new Error(
          "A turn did not stop; refusing to save or terminate live writers",
        );
      const terminalIds = listOpenTerminalSessionIdsOnHost(deps.db, hostId);
      await Promise.all(
        terminalIds.map((terminalId) =>
          deps.terminalSessions.closeTerminal({
            terminalId,
            payload: { mode: "force", reason: "user" },
          }),
        ),
      );
    }, drainDeadline);
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
    updateHost(deps.db, deps.hub, hostId, { statusMessage: null });
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
      phase,
      statusMessage: cancelled ? null : `Machine suspension failed: ${message}`,
    });
    deps.hub.notifyHost(hostId, ["host-disconnected"]);
    throw error;
  } finally {
    pauses.delete(hostId);
  }
}

async function boundedDrain(
  run: () => Promise<void>,
  deadline: { db: WorkSessionDeps["db"]; timeoutMs: number },
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        const expire = () => {
          if (isServerMoveFrozen(deadline.db)) {
            timer = setTimeout(expire, SERVER_MOVE_FROZEN_RETRY_MS);
            return;
          }
          reject(
            new Error(
              "Machine drain exceeded its deadline; old compute is retained",
            ),
          );
        };
        timer = setTimeout(expire, deadline.timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
