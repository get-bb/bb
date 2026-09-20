import { setTimeout as sleep } from "node:timers/promises";
import { getThread, listRunningThreads } from "@bb/db";
import { threadScope } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { appendSystemErrorEvent } from "../threads/thread-events.js";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

const RUNNING_WORK_POLL_MS = 250;

export interface StopRunningServerWorkArgs {
  pollMs?: number;
  targetHostName: string;
  timeoutMs: number;
}

async function stopRunningThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  row: { hostId: string | null; id: string },
  targetHostName: string,
): Promise<void> {
  const thread = getThread(deps.db, row.id);
  if (thread === null) {
    return;
  }
  const environment =
    thread.environmentId === null || row.hostId === null
      ? null
      : { id: thread.environmentId, hostId: row.hostId };
  if (thread.status === "active") {
    appendSystemErrorEvent(deps, {
      threadId: thread.id,
      environmentId: thread.environmentId,
      scope: threadScope(),
      code: "server_move",
      message: `The server is moving to ${targetHostName}, so this turn was stopped. Continue with a new turn after the move.`,
    });
  }
  await stopThreadForCurrentState(deps, thread, environment, {
    requireStopped: true,
  });
}

function turnCount(count: number): string {
  return count === 1 ? "1 turn" : `${count} turns`;
}

export async function stopRunningServerWork(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: StopRunningServerWorkArgs,
): Promise<void> {
  const deadline = Date.now() + args.timeoutMs;
  const pollMs = args.pollMs ?? RUNNING_WORK_POLL_MS;
  const inflight = new Map<string, Promise<void>>();
  const failures: unknown[] = [];
  while (true) {
    const failure = failures[0];
    if (failure !== undefined) {
      throw failure;
    }
    const running = listRunningThreads(deps.db);
    if (running.length === 0 && inflight.size === 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${turnCount(Math.max(running.length, inflight.size))} did not stop. Stop them, then try again.`,
      );
    }
    for (const row of running) {
      if (inflight.has(row.id)) {
        continue;
      }
      inflight.set(
        row.id,
        stopRunningThread(deps, row, args.targetHostName).then(
          () => {
            inflight.delete(row.id);
          },
          (error: unknown) => {
            inflight.delete(row.id);
            failures.push(error);
          },
        ),
      );
    }
    await Promise.race([
      sleep(Math.min(pollMs, Math.max(0, deadline - Date.now()))),
      ...inflight.values(),
    ]);
  }
}
