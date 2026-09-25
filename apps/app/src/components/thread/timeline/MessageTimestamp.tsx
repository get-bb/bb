// bb-fork(windows): small always-visible timestamp under each chat message,
// with the duration of the turn that produced it.
import { useContext } from "react";
import { durationToCompactString } from "@bb/thread-view";
import { useSecondTick } from "@/hooks/useSecondTick";
import {
  findTimelineTurnProcessTiming,
  TimelineTurnProcessContext,
} from "./timeline-turn-process.js";

const CLOCK_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const ABSOLUTE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const MINIMUM_VISIBLE_PROCESS_DURATION_MS = 1_000;

const TIMESTAMP_CLASS_NAME =
  "inline-flex select-none items-center whitespace-nowrap text-2xs leading-none text-subtle-foreground tabular-nums";

export interface MessageTimestampProps {
  createdAt: number;
  turnId: string | null;
}

export function formatMessageClockTime(timestamp: number): string {
  return CLOCK_TIME_FORMATTER.format(timestamp);
}

export function formatMessageAbsoluteTime(timestamp: number): string {
  return ABSOLUTE_TIME_FORMATTER.format(timestamp);
}

function LiveProcessDurationSuffix({ startedAt }: { startedAt: number }) {
  const now = useSecondTick();
  const durationMs = now - startedAt;
  if (durationMs < MINIMUM_VISIBLE_PROCESS_DURATION_MS) {
    return null;
  }
  return (
    <>
      {" · "}
      {durationToCompactString(durationMs)}
    </>
  );
}

function ProcessDurationSuffix({
  completedAt,
  live,
  startedAt,
}: {
  completedAt: number | null;
  live: boolean;
  startedAt: number | null;
}) {
  if (live && startedAt !== null) {
    return <LiveProcessDurationSuffix startedAt={startedAt} />;
  }
  if (completedAt === null || startedAt === null) {
    return null;
  }
  const durationMs = completedAt - startedAt;
  if (durationMs < MINIMUM_VISIBLE_PROCESS_DURATION_MS) {
    return null;
  }
  return (
    <>
      {" · "}
      {durationToCompactString(durationMs)}
    </>
  );
}

export function MessageTimestamp({ createdAt, turnId }: MessageTimestampProps) {
  const turnProcessTimings = useContext(TimelineTurnProcessContext);
  const turnProcessTiming = findTimelineTurnProcessTiming(
    turnProcessTimings,
    turnId,
  );
  return (
    <span
      data-message-timestamp=""
      title={formatMessageAbsoluteTime(createdAt)}
      className={TIMESTAMP_CLASS_NAME}
    >
      {formatMessageClockTime(createdAt)}
      <ProcessDurationSuffix
        completedAt={turnProcessTiming?.completedAt ?? null}
        live={turnProcessTiming?.live ?? false}
        startedAt={turnProcessTiming?.startedAt ?? null}
      />
    </span>
  );
}
