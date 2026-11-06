import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  environments,
  getExperiments,
  getThread,
  getUnfinishedCommandItemData,
  listCommandItemDataByItemIds,
  listOpenBackgroundTaskItemRowsForHost,
  listOwnerStoppedBackgroundTaskRowsForHost,
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
const MAX_NAMED_JOBS = 10;

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

interface StoppedBackgroundTaskRow {
  data: string;
  itemId: string;
  sequence: number | null;
  threadId: string;
}

function groupRowsByThread(
  rows: readonly StoppedBackgroundTaskRow[],
): Map<string, StoppedBackgroundTaskRow[]> {
  const rowsByThread = new Map<string, StoppedBackgroundTaskRow[]>();
  for (const row of rows) {
    const threadRows = rowsByThread.get(row.threadId) ?? [];
    threadRows.push(row);
    rowsByThread.set(row.threadId, threadRows);
  }
  return rowsByThread;
}

function nameStoppedBackgroundJobs(
  db: DbConnection,
  args: { rows: readonly StoppedBackgroundTaskRow[]; threadId: string },
): string[] {
  const tasks: { description: string; parentToolCallId: string | null }[] = [];
  const seenItemIds = new Set<string>();
  for (const row of args.rows) {
    if (seenItemIds.has(row.itemId)) {
      continue;
    }
    seenItemIds.add(row.itemId);
    const parsed = backgroundTaskItemDataSchema.safeParse(parseJson(row.data));
    if (!parsed.success || parsed.data.item.skipTranscript) {
      continue;
    }
    tasks.push({
      description: parsed.data.item.description,
      parentToolCallId: parsed.data.item.parentToolCallId ?? null,
    });
  }
  if (tasks.length === 0) {
    return [];
  }
  const commandByItemId = new Map<string, string>();
  for (const row of listCommandItemDataByItemIds(db, {
    threadId: args.threadId,
    itemIds: tasks.flatMap((task) =>
      task.parentToolCallId === null ? [] : [task.parentToolCallId],
    ),
  })) {
    const command = readCommand(row.data);
    if (command !== null) {
      commandByItemId.set(row.itemId, command);
    }
  }
  return tasks.map((task) =>
    nameBackgroundJob({
      command:
        task.parentToolCallId === null
          ? null
          : (commandByItemId.get(task.parentToolCallId) ?? null),
      description: task.description,
    }),
  );
}

function namedJobs(lead: string, jobs: readonly string[]): string {
  if (jobs.length === 1) {
    return `${lead}: ${jobs[0]}. `;
  }
  const lines = jobs.slice(0, MAX_NAMED_JOBS).map((job) => `- ${job}`);
  if (jobs.length > MAX_NAMED_JOBS) {
    lines.push(`- and ${jobs.length - MAX_NAMED_JOBS} more`);
  }
  return `${lead}:\n${lines.join("\n")}\n\n`;
}

function cutTurnContinuation(args: {
  command: string | null;
  jobs: readonly string[];
}): string {
  const cut =
    args.command === null
      ? "while you were working. The restart cut off your turn, not the user, even if your history says the user rejected it. Check whether your last step finished, then continue the task without repeating work."
      : `while you were running \`${args.command}\`. The restart cut it off, not the user, even if your history says the user rejected it. Check what it finished, then continue the task, rerunning it only if that is safe.`;
  if (args.jobs.length === 0) {
    return renderTemplate("systemMessageRestartResume", { details: cut });
  }
  const check =
    args.jobs.length === 1
      ? "Check how far it got, and restart it only if that is safe."
      : "Check how far each got, and restart only what is safe to restart.";
  return renderTemplate("systemMessageRestartResume", {
    details: `${cut} ${namedJobs("It also stopped this background work", args.jobs)}${check}`,
  });
}

function stoppedBackgroundWorkContinuation(jobs: readonly string[]): string {
  const check =
    jobs.length === 1
      ? "The user didn't stop it. Check whether it's still running and how far it got, then restart it only if that is safe."
      : "The user didn't stop them. Check whether each is still running and how far it got, then restart each only if that is safe.";
  return renderTemplate("systemMessageRestartResume", {
    details: `${namedJobs("and may have stopped this background work", jobs)}${check}`,
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
  args: { hostId: string; ownerStoppedSinceMs: number },
): Map<string, string> {
  const continuations = new Map<string, string>();
  if (!getExperiments(deps.db).resumeThreadsAfterRestart) {
    return continuations;
  }
  const openRowsByThread = groupRowsByThread(
    listOpenBackgroundTaskItemRowsForHost(deps.db, { hostId: args.hostId }).map(
      (row) => ({ ...row, sequence: null }),
    ),
  );
  const ownerStoppedRowsByThread = groupRowsByThread(
    listOwnerStoppedBackgroundTaskRowsForHost(deps.db, {
      hostId: args.hostId,
      settledSinceMs: args.ownerStoppedSinceMs,
    }),
  );
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
    const openRows = openRowsByThread.get(id) ?? [];
    const ownerStoppedRows = ownerStoppedRowsByThread.get(id) ?? [];
    if (
      status === "idle" &&
      openRows.length === 0 &&
      ownerStoppedRows.length === 0
    ) {
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
    if (turn === null) {
      continue;
    }
    const jobs = nameStoppedBackgroundJobs(deps.db, {
      rows: [
        ...openRows,
        ...ownerStoppedRows.filter(
          (row) => row.sequence !== null && row.sequence > turn.requestSequence,
        ),
      ],
      threadId: id,
    });
    if (status === "idle" && jobs.length === 0) {
      continue;
    }
    if (!withinResumeLimit(deps, { threadId: id, turn })) {
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
