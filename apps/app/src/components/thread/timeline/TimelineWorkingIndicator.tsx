import { cn } from "@bb/shared-ui/lib/utils";
import { ExpandableTimelineRow } from "./ExpandableTimelineRow.js";
import { TimelineReasoningDetail } from "./TimelineReasoningDetail.js";
import { TimelineStatusIndicator } from "./TimelineStatusIndicator.js";

interface TimelineWorkingIndicatorProps {
  label?: string;
  isThinking?: boolean;
  details?: string;
  reasoningId?: string;
  className?: string;
}

export function TimelineWorkingIndicator({
  label,
  isThinking = false,
  details,
  reasoningId,
  className,
}: TimelineWorkingIndicatorProps) {
  const resolvedLabel = label ?? (isThinking ? "Thinking…" : "Working...");
  const hasDetails = (details?.trim().length ?? 0) > 0;

  if (isThinking || hasDetails) {
    return (
      <div className={cn("mt-4", className)}>
        <ExpandableTimelineRow
          reasoningExpansionKey={reasoningId}
          expandable={hasDetails}
          title={{
            segments: [
              { text: resolvedLabel, em: false, shimmer: true, truncate: true },
            ],
            decorations: [],
            tone: "default",
            action: null,
            plain: resolvedLabel,
          }}
          renderBody={() => <TimelineReasoningDetail text={details ?? ""} />}
        />
      </div>
    );
  }

  return (
    <TimelineStatusIndicator
      label={<span className="animate-shine">{resolvedLabel}</span>}
      className={cn("mt-4 flex min-h-7 items-center", className)}
    />
  );
}
