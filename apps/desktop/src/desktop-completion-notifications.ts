import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import type { BbRealtimeConnectionEvent, ThreadRealtimeEvent } from "@bb/sdk";

export const COMPLETION_NOTIFICATION_SETTLE_MS = 300;
export const COMPLETION_NOTIFICATION_RETRY_MS = 1_000;
export const COMPLETION_NOTIFICATION_TITLE_MAX_LENGTH = 80;

const COMPLETION_NOTIFICATION_TITLE_SUFFIX = ": has finished";

export interface DesktopCompletionNotification {
  outcome: "completed" | "failed";
  projectId: string | null;
  threadId: string;
  title: string;
}

export interface DesktopCompletionNotificationWatcher {
  stop(): void;
}

export function formatDesktopCompletionNotificationTitle(
  threadTitle: string,
): string {
  const maxThreadTitleLength =
    COMPLETION_NOTIFICATION_TITLE_MAX_LENGTH -
    COMPLETION_NOTIFICATION_TITLE_SUFFIX.length;
  const characters = Array.from(threadTitle);
  const displayTitle =
    characters.length > maxThreadTitleLength
      ? `${characters.slice(0, maxThreadTitleLength - 1).join("")}…`
      : threadTitle;
  return `${displayTitle}${COMPLETION_NOTIFICATION_TITLE_SUFFIX}`;
}

export type DesktopCompletionThread = Pick<
  Thread,
  | "id"
  | "latestAttentionAt"
  | "parentThreadId"
  | "projectId"
  | "status"
  | "title"
  | "titleFallback"
>;

interface CreateDesktopCompletionNotificationWatcherArgs {
  fetchThread(
    threadId: string,
    signal: AbortSignal,
  ): Promise<DesktopCompletionThread | null>;
  listThreads(signal: AbortSignal): Promise<readonly DesktopCompletionThread[]>;
  notify(notification: DesktopCompletionNotification): void;
  subscribeToConnection(
    listener: (event: BbRealtimeConnectionEvent) => void,
  ): () => void;
  subscribeToThreadChanges(
    listener: (event: ThreadRealtimeEvent) => void,
  ): () => void;
  warn(message: string): void;
}

interface ResolveDesktopCompletionNotificationArgs {
  candidate: boolean;
  current: DesktopCompletionThread;
  previous: DesktopCompletionThread | undefined;
}

export function formatDesktopCompletionThreadUrl(
  appUrl: string,
  completion: Pick<DesktopCompletionNotification, "projectId" | "threadId">,
): string {
  const url = new URL(appUrl);
  const threadPath = `threads/${encodeURIComponent(completion.threadId)}`;
  url.pathname =
    completion.projectId === null
      ? `/${threadPath}`
      : `/projects/${encodeURIComponent(completion.projectId)}/${threadPath}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function threadDisplayTitle(thread: DesktopCompletionThread): string {
  const title = thread.title?.trim();
  if (title) {
    return title;
  }
  const fallback = thread.titleFallback?.trim();
  if (fallback) {
    return fallback;
  }
  return `Thread ${thread.id.slice(0, 8)}`;
}

function isSettledRootThread(thread: DesktopCompletionThread): boolean {
  return (
    thread.parentThreadId === null &&
    (thread.status === "idle" || thread.status === "error")
  );
}

export function resolveDesktopCompletionNotification({
  candidate,
  current,
  previous,
}: ResolveDesktopCompletionNotificationArgs): DesktopCompletionNotification | null {
  if (!isSettledRootThread(current)) {
    return null;
  }
  const completedSincePreviousSnapshot =
    previous !== undefined &&
    !isSettledRootThread(previous) &&
    current.latestAttentionAt > previous.latestAttentionAt;
  if (!candidate && !completedSincePreviousSnapshot) {
    return null;
  }
  return {
    outcome: current.status === "error" ? "failed" : "completed",
    projectId:
      current.projectId === PERSONAL_PROJECT_ID ? null : current.projectId,
    threadId: current.id,
    title: threadDisplayTitle(current),
  };
}

function isCompletionCandidate(event: ThreadRealtimeEvent): boolean {
  const eventTypes = event.metadata?.eventTypes;
  return (
    event.id !== undefined &&
    eventTypes?.includes("system/thread/interrupted") !== true &&
    (eventTypes?.includes("turn/completed") === true ||
      eventTypes?.includes("system/error") === true)
  );
}

function threadMap(
  threads: readonly DesktopCompletionThread[],
): Map<string, DesktopCompletionThread> {
  return new Map(threads.map((thread) => [thread.id, thread]));
}

export function createDesktopCompletionNotificationWatcher(
  args: CreateDesktopCompletionNotificationWatcherArgs,
): DesktopCompletionNotificationWatcher {
  const abortController = new AbortController();
  const completionCandidates = new Set<string>();
  const lastNotifiedAttentionAt = new Map<string, number>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const refreshVersions = new Map<string, number>();
  let knownThreads: Map<string, DesktopCompletionThread> | null = null;
  let reconcileShouldNotify = false;
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let workQueue = Promise.resolve();

  function warn(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    args.warn(`${action}: ${message}`);
  }

  function enqueue(work: () => Promise<void>): void {
    workQueue = workQueue
      .then(async () => {
        if (!stopped) {
          await work();
        }
      })
      .catch((error: unknown) => {
        if (!stopped) {
          warn("Completion notification reconciliation failed", error);
        }
      });
  }

  function notifyOnce(
    current: DesktopCompletionThread,
    previous: DesktopCompletionThread | undefined,
    candidate: boolean,
  ): void {
    const notification = resolveDesktopCompletionNotification({
      candidate,
      current,
      previous,
    });
    if (notification === null) {
      return;
    }
    const lastNotified = lastNotifiedAttentionAt.get(current.id);
    if (
      lastNotified !== undefined &&
      current.latestAttentionAt <= lastNotified
    ) {
      return;
    }
    lastNotifiedAttentionAt.set(current.id, current.latestAttentionAt);
    args.notify(notification);
  }

  function scheduleThreadRefresh(threadId: string, delayMs: number): void {
    const existingTimer = refreshTimers.get(threadId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }
    const version = refreshVersions.get(threadId) ?? 0;
    const timer = setTimeout(() => {
      refreshTimers.delete(threadId);
      enqueue(() => refreshThread(threadId, version));
    }, delayMs);
    refreshTimers.set(threadId, timer);
  }

  async function refreshThread(
    threadId: string,
    expectedVersion: number,
  ): Promise<void> {
    try {
      const current = await args.fetchThread(threadId, abortController.signal);
      if (stopped) {
        return;
      }
      const latestVersion = refreshVersions.get(threadId) ?? 0;
      if (latestVersion !== expectedVersion) {
        scheduleThreadRefresh(threadId, 0);
        return;
      }
      const previous = knownThreads?.get(threadId);
      if (current === null) {
        knownThreads?.delete(threadId);
      } else {
        knownThreads ??= new Map();
        knownThreads.set(threadId, current);
        notifyOnce(current, previous, completionCandidates.has(threadId));
      }
      completionCandidates.delete(threadId);
    } catch (error) {
      if (stopped || abortController.signal.aborted) {
        return;
      }
      warn(`Could not refresh completion state for ${threadId}`, error);
      scheduleThreadRefresh(threadId, COMPLETION_NOTIFICATION_RETRY_MS);
    }
  }

  function scheduleReconcile(
    notifyTransitions: boolean,
    delayMs: number,
  ): void {
    reconcileShouldNotify ||= notifyTransitions;
    if (reconcileTimer !== null) {
      clearTimeout(reconcileTimer);
    }
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      const shouldNotify = reconcileShouldNotify;
      reconcileShouldNotify = false;
      enqueue(() => reconcileThreads(shouldNotify));
    }, delayMs);
  }

  async function reconcileThreads(notifyTransitions: boolean): Promise<void> {
    try {
      const current = threadMap(await args.listThreads(abortController.signal));
      if (stopped) {
        return;
      }
      const previous = knownThreads;
      knownThreads = current;
      if (!notifyTransitions || previous === null) {
        return;
      }
      for (const thread of current.values()) {
        notifyOnce(thread, previous.get(thread.id), false);
      }
    } catch (error) {
      if (stopped || abortController.signal.aborted) {
        return;
      }
      warn("Could not reconcile completion notification state", error);
      scheduleReconcile(notifyTransitions, COMPLETION_NOTIFICATION_RETRY_MS);
    }
  }

  const unsubscribeThreadChanges = args.subscribeToThreadChanges((event) => {
    if (stopped || event.id === undefined) {
      return;
    }
    const candidate = isCompletionCandidate(event);
    if (!candidate && !event.changes.includes("status-changed")) {
      return;
    }
    const threadId = event.id;
    refreshVersions.set(threadId, (refreshVersions.get(threadId) ?? 0) + 1);
    if (candidate) {
      completionCandidates.add(threadId);
    }
    scheduleThreadRefresh(threadId, COMPLETION_NOTIFICATION_SETTLE_MS);
  });
  const unsubscribeConnection = args.subscribeToConnection((event) => {
    if (!stopped && event.state === "connected") {
      scheduleReconcile(event.reconnected, 0);
    }
  });

  return {
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      abortController.abort();
      unsubscribeThreadChanges();
      unsubscribeConnection();
      if (reconcileTimer !== null) {
        clearTimeout(reconcileTimer);
        reconcileTimer = null;
      }
      for (const timer of refreshTimers.values()) {
        clearTimeout(timer);
      }
      refreshTimers.clear();
      completionCandidates.clear();
    },
  };
}
