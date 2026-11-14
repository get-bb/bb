import {
  getThread,
  readThreadRunState,
  writeThreadLifecycleStateInTransaction,
} from "@bb/db";
import { THREAD_LIFECYCLE, type Thread, type ThreadStatusMove } from "@bb/domain";
import { announceThreadStatusChange } from "../../src/services/threads/lifecycle/finish.js";
import type { AppDeps } from "../../src/types.js";

type MoveThreadStatusResult =
  | { applied: true; thread: Thread }
  | { applied: false };

export function moveThreadStatus(
  deps: Pick<AppDeps, "db" | "hub" | "providerRegistry">,
  args: { move: ThreadStatusMove; threadId: string },
): MoveThreadStatusResult {
  const written = deps.db.transaction(
    (tx) => {
      const thread = getThread(tx, args.threadId);
      if (thread === null) return null;
      const to = THREAD_LIFECYCLE[thread.status][args.move];
      if (to === undefined) return null;
      const stored = readThreadRunState(tx, thread.id);
      const result = writeThreadLifecycleStateInTransaction(tx, {
        expectedStatus: thread.status,
        next: { ...stored, status: to },
        previous: stored,
        threadId: thread.id,
      });
      return result.kind === "written" ? result.thread : null;
    },
    { behavior: "immediate" },
  );
  if (written === null) return { applied: false };
  announceThreadStatusChange(deps, written);
  return { applied: true, thread: written };
}
