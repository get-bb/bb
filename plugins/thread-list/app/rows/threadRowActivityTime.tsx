import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_ROW_META_MUTED_CLASS,
  SIDEBAR_ROW_META_TEXT_CLASS,
  SIDEBAR_RUNTIME_STATUS_COLOR_CLASS,
} from "@/components/ui/sidebar-row-classes";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || !document.hidden;
}

function createIntervalTick(intervalMs: number): () => number {
  const listeners = new Set<() => void>();
  let lastTickMs = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    lastTickMs = Date.now();
    for (const listener of listeners) listener();
  }

  function startInterval(): void {
    if (intervalId === null && isDocumentVisible()) {
      intervalId = setInterval(tick, intervalMs);
    }
  }

  function stopInterval(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function handleVisibilityChange(): void {
    if (!isDocumentVisible()) {
      stopInterval();
      return;
    }
    if (listeners.size > 0 && intervalId === null) {
      tick();
      startInterval();
    }
  }

  function subscribe(listener: () => void): () => void {
    if (listeners.size === 0) {
      lastTickMs = Date.now();
      document.addEventListener("visibilitychange", handleVisibilityChange);
      startInterval();
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopInterval();
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
      }
    };
  }

  function getSnapshot(): number {
    if (lastTickMs === 0) lastTickMs = Date.now();
    return lastTickMs;
  }

  return function useIntervalTick(): number {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };
}

const useSecondTick = createIntervalTick(1_000);
const useMinuteTick = createIntervalTick(60_000);

export function formatThreadRowAge(args: {
  now: number;
  timestamp: number;
}): string {
  const diffMs = args.now - args.timestamp;
  if (diffMs < MINUTE_MS) return "just now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  const days = Math.floor(diffMs / DAY_MS);
  if (days === 1) return "Yesterday";
  if (diffMs < WEEK_MS) return `${days}d ago`;
  if (diffMs < 5 * WEEK_MS) return `${Math.floor(diffMs / WEEK_MS)}w ago`;
  return new Date(args.timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatThreadRowElapsed(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "0s";
  const totalSeconds = Math.round(durationMs / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

function ThreadRowProcessingTime({ activeSince }: { activeSince: number }) {
  useSecondTick();
  const elapsedMs = Math.max(0, Date.now() - activeSince);
  return (
    <span
      data-sidebar-thread-processing-time=""
      className={cn(
        "shrink-0 font-medium tabular-nums",
        SIDEBAR_RUNTIME_STATUS_COLOR_CLASS,
      )}
    >
      {formatThreadRowElapsed(elapsedMs)}
    </span>
  );
}

function ThreadRowIdleTime({ lastActivityAt }: { lastActivityAt: number }) {
  /*
   * The tick only schedules the re-render; the clock is read here. Taking the
   * tick's own value as `now` let a stale one freeze this label, and made a
   * timestamp newer than the tick read as a negative age — which formats as
   * "just now" and stays there.
   */
  useMinuteTick();
  return (
    <span
      data-sidebar-thread-idle-time=""
      className={cn("shrink-0", SIDEBAR_ROW_META_MUTED_CLASS)}
    >
      {formatThreadRowAge({ now: Date.now(), timestamp: lastActivityAt })}
    </span>
  );
}

interface ThreadRowActivityTimeProps {
  activeSince: number | null;
  lastActivityAt: number;
}

export function ThreadRowActivityTime({
  activeSince,
  lastActivityAt,
}: ThreadRowActivityTimeProps) {
  return (
    <span
      data-sidebar-thread-activity-time=""
      className={cn("ml-auto shrink-0 pl-1.5", SIDEBAR_ROW_META_TEXT_CLASS)}
    >
      {activeSince === null ? (
        <ThreadRowIdleTime lastActivityAt={lastActivityAt} />
      ) : (
        <ThreadRowProcessingTime activeSince={activeSince} />
      )}
    </span>
  );
}

export function ThreadRowBranch({ branchName }: { branchName: string }) {
  return (
    <span
      data-sidebar-thread-meta=""
      className={cn(
        "flex min-w-0 items-center gap-1",
        SIDEBAR_ROW_META_TEXT_CLASS,
        SIDEBAR_ROW_META_MUTED_CLASS,
      )}
    >
      <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
      <span className="truncate" title={branchName}>
        {branchName}
      </span>
    </span>
  );
}
