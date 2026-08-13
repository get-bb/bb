import { useEffect, useState } from "react";
import type { ThreadTimelineActiveTurnActivity } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";

const phaseLabel: Record<ThreadTimelineActiveTurnActivity["phase"], string> = {
  provider: "Waiting for provider",
  model: "Waiting for model output",
  command: "Command has stopped reporting",
  tool: "Tool has stopped reporting",
  compaction: "Compaction has stopped reporting",
  subagent: "Subagent has stopped reporting",
  workflow: "Workflow has stopped reporting",
};

function quietDurationLabel(quietMs: number): string {
  const minutes = Math.max(1, Math.floor(quietMs / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function ThreadActiveTurnWatchdogCard({
  activity,
  isStopping,
  onStop,
}: {
  activity: ThreadTimelineActiveTurnActivity | null;
  isStopping: boolean;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!activity) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [activity]);

  if (!activity) return null;
  const quietMs = Math.max(0, now - activity.updatedAt);
  if (quietMs < activity.quietThresholdMs) return null;

  const label = phaseLabel[activity.phase];
  const detail = activity.detail ? `: ${activity.detail}` : "";
  return (
    <PromptStackCard
      ariaLabel="Active turn warning"
      className="overflow-hidden"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <Icon
          name="AlertTriangle"
          className="size-3.5 shrink-0 text-warning-text"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{label}</span>
          {detail}. No progress for {quietDurationLabel(quietMs)}.
        </span>
        <button
          type="button"
          disabled={isStopping}
          onClick={onStop}
          className="shrink-0 rounded px-2 py-1 font-medium text-warning-text transition-colors hover:bg-state-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isStopping ? "Stopping..." : "Stop turn"}
        </button>
      </div>
    </PromptStackCard>
  );
}
