import { useState } from "react";
import {
  ExpandablePanel,
  getCollapsibleHeaderToneClass,
} from "../../ui/disclosure.js";
import { cn } from "@bb/shared-ui/lib/utils";
import { TimelineStatusIndicator } from "./TimelineStatusIndicator.js";

// Both indicator states — the plain status line and the expandable thinking
// header — render at this fixed height and vertically center their label. The
// expandable variant materializes the moment thinking text streams in; without
// a shared height the swap grows the row ~8px and the bottom-anchored timeline
// animates the jump (see HeightTransition's ResizeObserver).
const INDICATOR_HEADER_HEIGHT_CLASS = "min-h-7 items-center";

export interface TimelineWorkingIndicatorProps {
  label?: string;
  isThinking?: boolean;
  details?: string;
  className?: string;
}

export function TimelineWorkingIndicator({
  label,
  isThinking = false,
  details,
  className,
}: TimelineWorkingIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const resolvedLabel = label ?? (isThinking ? "Thinking..." : "Working...");
  const trimmedDetails = details?.trim() ?? "";

  if (trimmedDetails.length > 0) {
    return (
      <div className={cn("mt-4", className)}>
        <ExpandablePanel
          isExpanded={isExpanded}
          summaryContent={
            <span className="animate-shine">{resolvedLabel}</span>
          }
          headerToneClass={getCollapsibleHeaderToneClass(isExpanded)}
          headerClassName={INDICATOR_HEADER_HEIGHT_CLASS}
          onToggle={() => setIsExpanded((current) => !current)}
        >
          <div className="max-h-80 overflow-auto whitespace-pre-wrap text-sm italic leading-relaxed text-muted-foreground">
            {details}
          </div>
        </ExpandablePanel>
      </div>
    );
  }

  return (
    <TimelineStatusIndicator
      label={<span className="animate-shine">{resolvedLabel}</span>}
      className={cn("mt-4 flex", INDICATOR_HEADER_HEIGHT_CLASS, className)}
    />
  );
}
