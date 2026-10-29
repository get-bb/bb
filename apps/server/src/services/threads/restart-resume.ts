import { z } from "zod";
import {
  createQueuedThreadMessage,
  getActiveStoredTurnId,
  getEnvironment,
  getExperiments,
  getLastStoredTurnRequestEvent,
  getLatestThreadInterruption,
  getLatestThreadSequence,
  getPendingQueuedSystemNotice,
  getRunningCommandItemData,
  getThread,
  listLatestTurnRequestSystemMessageKinds,
  listQueuedThreadMessages,
  listRunningThreads,
  listStoredTurnCompletedRowsByTurnIds,
  listThreadIdsWithActivePendingInteractions,
  listUnclaimedQueuedSystemNotices,
  moveQueuedThreadMessageToFront,
  rescheduleQueuedThreadMessage,
  setQueuedThreadMessageWaitingOn,
  type DbConnection,
  type DbQueryConnection,
  type QueuedThreadMessageRow,
} from "@bb/db";
import {
  queuedMessageSystemNoticeSchema,
  threadEventTurnStatusSchema,
  type SystemThreadInterruptedReason,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { listAwaitedBackgroundWorkByThread } from "./background-task-reconciliation.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { parseStoredQueuedThreadMessageWaitingOn } from "./thread-queued-messages.js";

const MAX_CONSECUTIVE_RESTART_RESUMES = 3;
const RESUME_DELAY_MS = 3_000;
const RESUME_STAGGER_MS = 5_000;
const RESUME_PARKED_FOR_MS = 24 * 60 * 60 * 1000;
const RESTART_INTERRUPTION_REASONS: ReadonlySet<SystemThreadInterruptedReason> =
  new Set(["host-daemon-restarted"]);
const ORDERED_BEHIND_RESUME_WAITS = new Set([
  "host-offline",
  "stopping",
  "thread-busy",
  "turn-starting",
]);

const runningCommandItemDataSchema = z.object({
  item: z.object({ command: z.string().min(1) }),
});
const turnCompletedDataSchema = z.object({
  status: threadEventTurnStatusSchema,
});

export type RestartWork =
  | { kind: "turn"; threadId: string }
  | { kind: "background"; jobs: readonly string[]; threadId: string };

interface RestartResumeSubject {
  afterSequence: number;
  turnId: string | null;
}

interface PendingRestartResume {
  row: QueuedThreadMessageRow;
  subject: RestartResumeSubject;
}

interface ResumeText {
  check: string;
  interrupted: string;
  restarted: string;
}

type RestartResumeDeps = LoggedPendingInteractionWorkSessionDeps;

export function isRestartContinuationEnabled(db: DbConnection): boolean {
  return getExperiments(db).continueThreadsAfterRestarts;
}

function readSubject(row: QueuedThreadMessageRow): RestartResumeSubject | null {
  if (row.systemNotice === null) return null;
  const notice = queuedMessageSystemNoticeSchema.safeParse(
    JSON.parse(row.systemNotice),
  );
  if (
    !notice.success ||
    notice.data.kind !== "restart-resume" ||
    notice.data.subject?.kind !== "restart"
  ) {
    return null;
  }
  return {
    afterSequence: notice.data.subject.afterSequence,
    turnId: notice.data.subject.turnId,
  };
}

function getPendingRestartResume(
  db: DbQueryConnection,
  threadId: string,
): PendingRestartResume | null {
  const row = getPendingQueuedSystemNotice(db, {
    kind: "restart-resume",
    threadId,
  });
  if (row === null) return null;
  const subject = readSubject(row);
  return subject === null ? null : { row, subject };
}

function threadHostId(db: DbConnection, threadId: string): string | null {
  const environmentId = getThread(db, threadId)?.environmentId ?? null;
  return environmentId === null
    ? null
    : (getEnvironment(db, environmentId)?.hostId ?? null);
}

function runningCommand(db: DbQueryConnection, threadId: string): string | null {
  const data = getRunningCommandItemData(db, { threadId });
  if (data === null) return null;
  try {
    const parsed = runningCommandItemDataSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data.item.command : null;
  } catch {
    return null;
  }
}

const RESTARTED = "bb restarted, or the machine running this thread did,";

function turnResumeText(args: {
  awaitingUser: boolean;
  command: string | null;
}): ResumeText {
  const restarted = RESTARTED;
  if (args.awaitingUser) {
    return {
      restarted,
      interrupted:
        args.command === null
          ? "while you were waiting for the user"
          : `while you were waiting for the user to approve \`${args.command}\``,
      check:
        "The restart cancelled that request; the user did not answer it, even if your history shows it as interrupted or rejected. Ask again if you still need it, and do not decide for them.",
    };
  }
  if (args.command === null) {
    return {
      restarted,
      interrupted: "while you were working",
      check:
        "The restart interrupted your turn; the user did not, even if your history shows it as interrupted or rejected by the user. Check whether your last step finished or is still running, then continue the task without repeating work that already happened.",
    };
  }
  return {
    restarted,
    interrupted: `while you were running \`${args.command}\``,
    check:
      "The restart interrupted it; the user did not reject it, even if your history shows it as interrupted or rejected by the user. It may have completed, partly completed, never run, or still be running, so check its effects, then continue the task, rerunning it only if that is safe.",
  };
}

function backgroundResumeText(jobs: readonly string[]): ResumeText {
  return {
    restarted: RESTARTED,
    interrupted: `while this background work was running: ${jobs
      .map((job) => `\`${job}\``)
      .join(", ")}`,
    check:
      "The restart may have stopped it. Check whether each is still running and how far it got, and restart one only when that is safe; otherwise explain what needs attention.",
  };
}

function hasReachedResumeLimit(db: DbQueryConnection, threadId: string): boolean {
  const kinds = listLatestTurnRequestSystemMessageKinds(db, {
    limit: MAX_CONSECUTIVE_RESTART_RESUMES,
    threadId,
  });
  return (
    kinds.length === MAX_CONSECUTIVE_RESTART_RESUMES &&
    kinds.every((kind) => kind === "restart-resume")
  );
}

export async function recordRestartResumes(
  deps: RestartResumeDeps,
  args: { now: number; work: readonly RestartWork[] },
): Promise<string[]> {
  const awaitingUser = new Set(
    listThreadIdsWithActivePendingInteractions(deps.db),
  );
  const prepared = [];
  const seen = new Set<string>();
  for (const work of args.work) {
    if (seen.has(work.threadId)) continue;
    seen.add(work.threadId);
    const thread = getThread(deps.db, work.threadId);
    if (
      thread === null ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      getPendingRestartResume(deps.db, thread.id) !== null
    ) {
      continue;
    }
    if (hasReachedResumeLimit(deps.db, thread.id)) {
      deps.logger.warn(
        { threadId: thread.id },
        "Not resuming a thread that restarts keep interrupting",
      );
      continue;
    }
    const text =
      work.kind === "turn"
        ? turnResumeText({
            awaitingUser: awaitingUser.has(thread.id),
            command: runningCommand(deps.db, thread.id),
          })
        : backgroundResumeText(work.jobs);
    try {
      prepared.push({
        execution: await buildExecutionOptions(
          deps,
          {},
          { threadId: thread.id },
        ),
        text,
        threadId: thread.id,
        turnId:
          work.kind === "turn" ? getActiveStoredTurnId(deps.db, thread.id) : null,
      });
    } catch (error) {
      deps.logger.warn(
        { error, threadId: thread.id },
        "Could not prepare a resume message for a restart",
      );
    }
  }
  const recorded: string[] = [];
  for (const entry of prepared) {
    if (getPendingRestartResume(deps.db, entry.threadId) !== null) continue;
    createQueuedThreadMessage(deps.db, deps.hub, {
      threadId: entry.threadId,
      content: [
        {
          type: "text",
          text: renderTemplate("systemMessageRestartResume", entry.text),
          mentions: [],
        },
      ],
      senderThreadId: null,
      origin: null,
      originPluginId: null,
      model: entry.execution.model,
      reasoningLevel: entry.execution.reasoningLevel,
      permissionMode: entry.execution.permissionMode,
      serviceTier: entry.execution.serviceTier,
      waitingOn: { kind: "time" },
      sendAt: args.now + RESUME_PARKED_FOR_MS,
      payload: { kind: "inline" },
      systemNotice: {
        kind: "restart-resume",
        subject: {
          kind: "restart",
          afterSequence: getLatestThreadSequence(deps.db, {
            threadId: entry.threadId,
          }),
          turnId: entry.turnId,
        },
      },
    });
    recorded.push(entry.threadId);
  }
  return recorded;
}

function resumingAncestorCount(
  db: DbConnection,
  threadId: string,
  resuming: ReadonlyMap<string, string | null>,
): number {
  let count = 0;
  const seen = new Set([threadId]);
  let parentId = getThread(db, threadId)?.parentThreadId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    if (resuming.has(parentId)) count += 1;
    parentId = getThread(db, parentId)?.parentThreadId ?? null;
  }
  return count;
}

function childrenFirst(
  db: DbConnection,
  hostIdByThread: ReadonlyMap<string, string | null>,
): [string, string | null][] {
  return [...hostIdByThread]
    .map((entry) => ({
      depth: resumingAncestorCount(db, entry[0], hostIdByThread),
      entry,
    }))
    .sort((a, b) => b.depth - a.depth)
    .map(({ entry }) => entry);
}

export function scheduleRestartResumes(
  deps: RestartResumeDeps,
  args: { hostIdByThread: ReadonlyMap<string, string | null>; startAt: number },
): Map<string, number> {
  const sendAtByThread = new Map<string, number>();
  const offsetByHost = new Map<string, number>();
  for (const [threadId, hostId] of childrenFirst(
    deps.db,
    args.hostIdByThread,
  )) {
    const pending = getPendingRestartResume(deps.db, threadId);
    if (pending === null) continue;
    const hostKey = hostId ?? threadId;
    const offset = offsetByHost.get(hostKey) ?? 0;
    const sendAt = args.startAt + offset * RESUME_STAGGER_MS;
    if (
      rescheduleQueuedThreadMessage(deps.db, deps.hub, {
        id: pending.row.id,
        sendAt,
      }) === null
    ) {
      continue;
    }
    offsetByHost.set(hostKey, offset + 1);
    moveQueuedThreadMessageToFront(deps.db, deps.hub, {
      id: pending.row.id,
      threadId,
    });
    let behind = 0;
    for (const row of listQueuedThreadMessages(deps.db, threadId)) {
      if (row.id === pending.row.id || row.failureReason !== null) continue;
      const waitingOn = parseStoredQueuedThreadMessageWaitingOn(row);
      if (waitingOn === null || !ORDERED_BEHIND_RESUME_WAITS.has(waitingOn.kind)) {
        continue;
      }
      behind += 1;
      rescheduleQueuedThreadMessage(deps.db, deps.hub, {
        id: row.id,
        sendAt: sendAt + behind,
      });
    }
    sendAtByThread.set(threadId, sendAt);
  }
  return sendAtByThread;
}

export async function resumeWorkCutByHostRestart(
  deps: RestartResumeDeps,
  args: { hostId: string; now: number },
): Promise<void> {
  if (!isRestartContinuationEnabled(deps.db)) return;
  const running = listRunningThreads(deps.db)
    .filter((row) => row.hostId === args.hostId)
    .map((row) => row.id);
  const runningSet = new Set(running);
  const background = [
    ...listAwaitedBackgroundWorkByThread(deps.db, args.hostId),
  ].filter(([threadId]) => !runningSet.has(threadId));
  await recordRestartResumes(deps, {
    now: args.now,
    work: [
      ...running.map((threadId) => ({ kind: "turn" as const, threadId })),
      ...background.map(([threadId, jobs]) => ({
        jobs,
        kind: "background" as const,
        threadId,
      })),
    ],
  });
  scheduleRestartResumes(deps, {
    hostIdByThread: new Map(
      [...running, ...background.map(([threadId]) => threadId)].map(
        (threadId) => [threadId, args.hostId],
      ),
    ),
    startAt: args.now + RESUME_DELAY_MS,
  });
}

export async function resumeTurnsCutByRestart(
  deps: RestartResumeDeps,
  args: { hostId: string; now: number; threadIds: readonly string[] },
): Promise<void> {
  if (args.threadIds.length === 0 || !isRestartContinuationEnabled(deps.db)) {
    return;
  }
  await recordRestartResumes(deps, {
    now: args.now,
    work: args.threadIds.map((threadId) => ({ kind: "turn", threadId })),
  });
  scheduleRestartResumes(deps, {
    hostIdByThread: new Map(
      args.threadIds.map((threadId) => [threadId, args.hostId]),
    ),
    startAt: args.now + RESUME_DELAY_MS,
  });
}

export function releaseRestartResumes(
  deps: RestartResumeDeps,
  args: { now: number },
): string[] {
  const running = new Map(
    listRunningThreads(deps.db).map((row) => [row.id, row.hostId]),
  );
  const ready = new Map<string, string | null>();
  for (const row of listUnclaimedQueuedSystemNotices(deps.db, "restart-resume")) {
    if (row.failureReason !== null) continue;
    if (running.has(row.threadId)) {
      setQueuedThreadMessageWaitingOn(deps.db, deps.hub, {
        id: row.id,
        threadId: row.threadId,
        waitingOn: { kind: "thread-busy" },
        sendAt: null,
      });
      continue;
    }
    ready.set(row.threadId, threadHostId(deps.db, row.threadId));
  }
  return [
    ...scheduleRestartResumes(deps, {
      hostIdByThread: ready,
      startAt: args.now + RESUME_DELAY_MS,
    }).keys(),
  ];
}

export async function recordResumesForShutdown(
  deps: RestartResumeDeps,
  args: { now: number },
): Promise<void> {
  if (!isRestartContinuationEnabled(deps.db)) return;
  await recordRestartResumes(deps, {
    now: args.now,
    work: listRunningThreads(deps.db).map((row) => ({
      kind: "turn",
      threadId: row.id,
    })),
  });
}

export function isStaleRestartResume(
  db: DbConnection,
  args: { subject: RestartResumeSubject; threadId: string },
): boolean {
  const latestTurnRequest = getLastStoredTurnRequestEvent(db, args.threadId);
  if (
    latestTurnRequest !== null &&
    latestTurnRequest.sequence > args.subject.afterSequence
  ) {
    return true;
  }
  if (args.subject.turnId !== null) {
    const [completed] = listStoredTurnCompletedRowsByTurnIds(db, {
      threadId: args.threadId,
      turnIds: [args.subject.turnId],
    });
    if (completed !== undefined) {
      const data = turnCompletedDataSchema.safeParse(JSON.parse(completed.data));
      if (data.success && data.data.status === "completed") return true;
    }
  }
  const interruption = getLatestThreadInterruption(db, {
    threadId: args.threadId,
  });
  return (
    interruption !== null &&
    interruption.sequence > args.subject.afterSequence &&
    !RESTART_INTERRUPTION_REASONS.has(interruption.reason)
  );
}

export function readRestartResumeSubject(
  row: QueuedThreadMessageRow,
): RestartResumeSubject | null {
  return readSubject(row);
}

export function isTurnFailureHandledByRestartResume(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  const pending = getPendingRestartResume(db, threadId);
  if (pending === null) return false;
  const interruption = getLatestThreadInterruption(db, { threadId });
  return (
    interruption !== null &&
    RESTART_INTERRUPTION_REASONS.has(interruption.reason) &&
    interruption.sequence > pending.subject.afterSequence
  );
}

export function hasPendingRestartResume(
  db: DbQueryConnection,
  threadId: string,
): boolean {
  return getPendingRestartResume(db, threadId) !== null;
}
