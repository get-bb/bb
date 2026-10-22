import { setTimeout as sleep } from "node:timers/promises";
import {
  createQueuedThreadMessage,
  getRunningCommandForThread,
  getThread,
  listRunningThreads,
  listUnclaimedQueuedSystemNotices,
  rescheduleQueuedThreadMessage,
} from "@bb/db";
import { renderTemplate } from "@bb/templates";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";
import { requireThreadEnvironment } from "../lib/entity-lookup.js";
import { listOpenBackgroundTaskDescriptionsByThread } from "../threads/background-task-reconciliation.js";
import { buildExecutionOptions } from "../threads/thread-commands.js";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";

const STOP_GRACE_MS = 5_000;
const RESUME_STAGGER_MS = 10_000;
const RESUME_PARKED_FOR_MS = 24 * 60 * 60 * 1000;

export interface AppUpdateInterruptedThread {
  command: string | null;
  providerId: string;
  threadId: string;
}

export interface AppUpdateIdleThreadWithJobs {
  jobs: string[];
  threadId: string;
}

export interface AppUpdateInterruptResult {
  idleThreadsWithJobs: AppUpdateIdleThreadWithJobs[];
  threads: AppUpdateInterruptedThread[];
  waitMs: number;
}

export interface AppUpdateResumer {
  interrupt(): Promise<AppUpdateInterruptResult>;
  parkResumes(args: {
    result: AppUpdateInterruptResult;
    targetVersion: string;
  }): Promise<void>;
  releaseResumes(): number;
  resumedThreadCount(): number;
}

interface ResumeText {
  check: string;
  interrupted: string;
}

function resumeTextForThread(thread: AppUpdateInterruptedThread): ResumeText {
  return thread.command === null
    ? {
        interrupted: "while you were working",
        check: "Check whether your last step finished, then continue.",
      }
    : {
        interrupted: `while you were running \`${thread.command}\``,
        check: "It may be half applied, so check it, then continue.",
      };
}

function resumeTextForJobs(jobs: readonly string[]): ResumeText {
  return {
    interrupted: `while these background jobs were running: ${jobs
      .map((job) => `\`${job}\``)
      .join(", ")}`,
    check: "They stopped at the restart. Restart any of them you still need.",
  };
}

export function createAppUpdateResumer(args: {
  deps: LoggedPendingInteractionWorkSessionDeps;
  now?: () => number;
  stopGraceMs?: number;
}): AppUpdateResumer {
  const { deps } = args;
  const now = args.now ?? Date.now;
  const stopGraceMs = args.stopGraceMs ?? STOP_GRACE_MS;
  let resumedThreadCount = 0;

  const stopRunningThreads = async (
    threadIds: readonly string[],
  ): Promise<void> => {
    const stops = threadIds.flatMap((threadId) => {
      const thread = getThread(deps.db, threadId);
      const hostId = resumeHostKey(deps, threadId);
      if (
        thread === null ||
        thread.environmentId === null ||
        hostId === threadId
      ) {
        return [];
      }
      return [
        stopThreadForCurrentState(deps, thread, {
          id: thread.environmentId,
          hostId,
        }).catch((error: unknown) => {
          deps.logger.warn(
            { error, threadId },
            "Could not stop a thread before the bb update",
          );
        }),
      ];
    });
    if (stops.length === 0) return;
    await Promise.race([Promise.allSettled(stops), sleep(stopGraceMs)]);
  };

  const parkResume = async (
    threadId: string,
    text: ResumeText,
    targetVersion: string,
    parkedUntil: number,
  ): Promise<void> => {
    const thread = getThread(deps.db, threadId);
    if (
      thread === null ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null
    ) {
      return;
    }
    const execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
    );
    createQueuedThreadMessage(deps.db, deps.hub, {
      threadId: thread.id,
      content: [
        {
          type: "text",
          text: renderTemplate("systemMessageAppUpdateResume", text),
          mentions: [],
        },
      ],
      senderThreadId: null,
      origin: null,
      originPluginId: null,
      model: execution.model,
      reasoningLevel: execution.reasoningLevel,
      permissionMode: execution.permissionMode,
      serviceTier: execution.serviceTier,
      waitingOn: { kind: "time" },
      sendAt: parkedUntil,
      payload: { kind: "inline" },
      systemNotice: {
        kind: "app-update-resume",
        subject: { kind: "app-update", targetVersion },
      },
    });
  };

  return {
    async interrupt() {
      const startedAt = now();
      const threads: AppUpdateInterruptedThread[] = [];
      const seen = new Set<string>();
      const collectRunning = (): string[] => {
        const added: string[] = [];
        for (const row of listRunningThreads(deps.db)) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          threads.push({
            command: getRunningCommandForThread(deps.db, { threadId: row.id }),
            providerId: row.providerId,
            threadId: row.id,
          });
          added.push(row.id);
        }
        return added;
      };
      await stopRunningThreads(collectRunning());
      await stopRunningThreads(collectRunning());
      const primaryHostId = resolvePrimaryHostId(deps);
      const idleThreadsWithJobs =
        primaryHostId === null
          ? []
          : [
              ...listOpenBackgroundTaskDescriptionsByThread(
                deps.db,
                primaryHostId,
              ),
            ]
              .filter(([threadId]) => !seen.has(threadId))
              .map(([threadId, jobs]) => ({ jobs, threadId }));
      return { idleThreadsWithJobs, threads, waitMs: now() - startedAt };
    },

    async parkResumes({ result, targetVersion }) {
      const parkedUntil = now() + RESUME_PARKED_FOR_MS;
      const resumes = [
        ...result.threads.map((thread) => ({
          threadId: thread.threadId,
          text: resumeTextForThread(thread),
        })),
        ...result.idleThreadsWithJobs.map((entry) => ({
          threadId: entry.threadId,
          text: resumeTextForJobs(entry.jobs),
        })),
      ];
      const parked = new Set(
        listUnclaimedQueuedSystemNotices(deps.db, "app-update-resume").map(
          (row) => row.threadId,
        ),
      );
      for (const resume of resumes) {
        if (parked.has(resume.threadId)) continue;
        parked.add(resume.threadId);
        try {
          await parkResume(
            resume.threadId,
            resume.text,
            targetVersion,
            parkedUntil,
          );
        } catch (error) {
          deps.logger.warn(
            { error, threadId: resume.threadId },
            "Could not queue a resume message for the bb update",
          );
        }
      }
    },

    releaseResumes() {
      const rows = listUnclaimedQueuedSystemNotices(
        deps.db,
        "app-update-resume",
      );
      const releaseAt = now();
      const offsetByHost = new Map<string, number>();
      let released = 0;
      for (const row of rows) {
        const hostKey = resumeHostKey(deps, row.threadId);
        const offset = offsetByHost.get(hostKey) ?? 0;
        offsetByHost.set(hostKey, offset + 1);
        if (
          rescheduleQueuedThreadMessage(deps.db, deps.hub, {
            id: row.id,
            sendAt: releaseAt + offset * RESUME_STAGGER_MS,
          }) !== null
        ) {
          released += 1;
        }
      }
      resumedThreadCount += released;
      return released;
    },

    resumedThreadCount() {
      return resumedThreadCount;
    },
  };
}

function resumeHostKey(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): string {
  try {
    return requireThreadEnvironment(deps.db, threadId).environment.hostId;
  } catch {
    return threadId;
  }
}
