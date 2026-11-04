import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  environments,
  getExperiments,
  getThread,
  getUnfinishedCommandItemData,
  listCommandItemDataByItemIds,
  listOpenBackgroundTaskItemRowsForHost,
  liveThread,
  threads,
  type DbConnection,
} from "@bb/db";
import {
  RESTART_RESUME_RETRY_REASON,
  threadEventBackgroundTaskItemSchema,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueChildThreadTurnNotificationBestEffort } from "./child-thread-notifications.js";
import { isParentNotifiableChildThread } from "./thread-parent.js";
import {
  loadFailedTurn,
  retryChain,
  type FailedTurnRecord,
} from "./turn-failed.js";
import { retryTurnAfterRestart } from "./turn-retry.js";

type RestartResumeDeps = LoggedPendingInteractionWorkSessionDeps;

const RESTART_RESUME_DELAY_MS = 5_000;
const MAX_RESTART_RESUME_ATTEMPT = 4;
const MAX_NAMED_COMMAND_CHARS = 200;

const commandItemDataSchema = z.object({
  item: z.object({ command: z.string().min(1) }),
});
const backgroundTaskItemDataSchema = z.object({
  item: threadEventBackgroundTaskItemSchema,
});

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function readCommand(data: string): string | null {
  const parsed = commandItemDataSchema.safeParse(parseJson(data));
  if (!parsed.success) {
    return null;
  }
  const command = parsed.data.item.command.trim();
  return command.length > MAX_NAMED_COMMAND_CHARS
    ? `${command.slice(0, MAX_NAMED_COMMAND_CHARS)}…`
    : command;
}

function nameBackgroundJob(args: {
  command: string | null;
  description: string;
}): string {
  if (args.command === null) {
    return `\`${args.description}\``;
  }
  return args.description === args.command
    ? `\`${args.command}\``
    : `\`${args.command}\` (${args.description})`;
}

function listStoppedBackgroundJobsByThread(
  db: DbConnection,
  hostId: string,
): Map<string, string[]> {
  const tasksByThread = new Map<
    string,
    { description: string; parentToolCallId: string | null }[]
  >();
  for (const row of listOpenBackgroundTaskItemRowsForHost(db, { hostId })) {
    const parsed = backgroundTaskItemDataSchema.safeParse(parseJson(row.data));
    if (!parsed.success || parsed.data.item.skipTranscript) {
      continue;
    }
    const tasks = tasksByThread.get(row.threadId) ?? [];
    tasks.push({
      description: parsed.data.item.description,
      parentToolCallId: parsed.data.item.parentToolCallId ?? null,
    });
    tasksByThread.set(row.threadId, tasks);
  }
  const jobsByThread = new Map<string, string[]>();
  for (const [threadId, tasks] of tasksByThread) {
    const commandByItemId = new Map<string, string>();
    for (const row of listCommandItemDataByItemIds(db, {
      threadId,
      itemIds: tasks.flatMap((task) =>
        task.parentToolCallId === null ? [] : [task.parentToolCallId],
      ),
    })) {
      const command = readCommand(row.data);
      if (command !== null) {
        commandByItemId.set(row.itemId, command);
      }
    }
    jobsByThread.set(
      threadId,
      tasks.map((task) =>
        nameBackgroundJob({
          command:
            task.parentToolCallId === null
              ? null
              : (commandByItemId.get(task.parentToolCallId) ?? null),
          description: task.description,
        }),
      ),
    );
  }
  return jobsByThread;
}

function cutTurnContinuation(args: {
  command: string | null;
  jobs: readonly string[];
}): string {
  const stoppedJobs =
    args.jobs.length === 0
      ? ""
      : ` The restart also stopped this background work: ${args.jobs.join(", ")}. Check how far each got, and restart one only when that is safe.`;
  if (args.command === null) {
    return renderTemplate("systemMessageRestartResume", {
      interrupted: "while you were working",
      check: `The restart interrupted your turn; the user did not, even if your history shows it as interrupted or rejected by the user. Check whether your last step finished or is still running, then continue the task without repeating work that already happened.${stoppedJobs}`,
    });
  }
  return renderTemplate("systemMessageRestartResume", {
    interrupted: `while you were running \`${args.command}\``,
    check: `The restart interrupted it; the user did not reject it, even if your history shows it as interrupted or rejected by the user. It may have completed, partly completed, never run, or still be running, so check its effects, then continue the task, rerunning it only if that is safe.${stoppedJobs}`,
  });
}

function stoppedBackgroundWorkContinuation(jobs: readonly string[]): string {
  return renderTemplate("systemMessageRestartResume", {
    interrupted: `while this background work was running: ${jobs.join(", ")}`,
    check:
      "The restart may have stopped it; the user did not, even if your history shows it as stopped or killed. Check whether each is still running and how far it got, and restart one only when that is safe; otherwise explain what needs attention.",
  });
}

function withinResumeLimit(
  deps: RestartResumeDeps,
  args: { threadId: string; turn: FailedTurnRecord },
): boolean {
  const attempt = retryChain(args.turn.request).attemptNumber + 1;
  if (attempt <= MAX_RESTART_RESUME_ATTEMPT) {
    return true;
  }
  deps.logger.warn(
    {
      attempt,
      requestId: args.turn.request.requestId,
      threadId: args.threadId,
    },
    "Not resuming a thread that restarts keep cutting off",
  );
  return false;
}

export function planRestartResumes(
  deps: RestartResumeDeps,
  args: { hostId: string },
): Map<string, string> {
  const continuations = new Map<string, string>();
  if (!getExperiments(deps.db).resumeThreadsAfterRestart) {
    return continuations;
  }
  const jobsByThread = listStoppedBackgroundJobsByThread(deps.db, args.hostId);
  const candidates = deps.db
    .select({ id: threads.id, status: threads.status })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(threads.status, ["active", "idle"]),
        liveThread,
      ),
    )
    .all();
  for (const { id, status } of candidates) {
    const jobs = jobsByThread.get(id) ?? [];
    if (status === "idle" && jobs.length === 0) {
      continue;
    }
    if (
      status === "active" &&
      deps.pendingInteractions.hasTurnBoundPendingThreadInteraction(id)
    ) {
      deps.logger.info(
        { threadId: id },
        "Not resuming a thread a restart cut while it waited on the user",
      );
      continue;
    }
    const turn = loadFailedTurn(deps.db, id);
    if (turn === null || !withinResumeLimit(deps, { threadId: id, turn })) {
      continue;
    }
    if (status === "idle") {
      continuations.set(id, stoppedBackgroundWorkContinuation(jobs));
      continue;
    }
    const commandData = getUnfinishedCommandItemData(deps.db, {
      afterSequence: turn.requestSequence,
      threadId: id,
    });
    continuations.set(
      id,
      cutTurnContinuation({
        command: commandData === null ? null : readCommand(commandData),
        jobs,
      }),
    );
  }
  return continuations;
}

export async function queueRestartResumes(
  deps: RestartResumeDeps,
  args: {
    continuations: ReadonlyMap<string, string>;
    interrupted: ReadonlyArray<{
      interruptedTurnId: string | null;
      threadId: string;
    }>;
  },
): Promise<void> {
  const sendAt = Date.now() + RESTART_RESUME_DELAY_MS;
  const interruptedTurnIdByThreadId = new Map(
    args.interrupted.map((entry) => [entry.threadId, entry.interruptedTurnId]),
  );
  for (const [threadId, continuation] of args.continuations) {
    const thread = getThread(deps.db, threadId);
    if (thread === null) {
      continue;
    }
    try {
      const result = await retryTurnAfterRestart(deps, {
        continuation,
        thread,
        request: {
          turnRequestId: null,
          sendAt,
          reason: RESTART_RESUME_RETRY_REASON,
        },
      });
      deps.logger.info(
        {
          attempt: result.attempt,
          delivery: result.delivery,
          threadId,
          turnRequestId: result.turnRequestId,
        },
        "Queued a resume for a thread a restart cut off",
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body.code === "retry_already_queued"
      ) {
        continue;
      }
      deps.logger.warn(
        { err: error, threadId },
        "Could not queue a resume for a thread a restart cut off",
      );
      const interruptedTurnId = interruptedTurnIdByThreadId.get(threadId);
      const current = getThread(deps.db, threadId);
      if (
        interruptedTurnId !== undefined &&
        interruptedTurnId !== null &&
        current !== null &&
        isParentNotifiableChildThread(current, "interrupted")
      ) {
        await queueChildThreadTurnNotificationBestEffort(deps, {
          childThread: current,
          parentThreadId: current.parentThreadId,
          turnStatus: "interrupted",
          turnId: interruptedTurnId,
          interruption: { reason: "host-daemon-restarted" },
        });
      }
    }
  }
}
