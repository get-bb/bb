import { useId, useState } from "react";
import { isBackgroundAgentTaskType } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { LiveDurationText } from "@/components/thread/timeline/LiveDurationText";
import { activityIconClass } from "@bb/shared-ui/activity-row-styles";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

const ROW_CLASS =
  "flex h-8 w-full min-w-0 items-center gap-2 px-3 text-left text-xs";
const OLDER_ROW_STAGGER_MS = 40;

function backgroundActivityGroupLabel(
  rows: readonly TimelineWorkflowWorkRow[],
): string {
  const hasAgent = rows.some((row) => isBackgroundAgentTaskType(row.taskType));
  const hasCommand = rows.some(
    (row) => !isBackgroundAgentTaskType(row.taskType),
  );
  if (hasAgent && hasCommand) {
    return "Background activity";
  }
  return hasAgent ? "Background agents" : "Background commands";
}

function backgroundActivityModel(row: TimelineWorkflowWorkRow): string | null {
  return isBackgroundAgentTaskType(row.taskType) ? row.model : null;
}

function BackgroundActivityRow({
  row,
  showDuration,
}: {
  row: TimelineWorkflowWorkRow;
  showDuration: boolean;
}) {
  const isAgent = isBackgroundAgentTaskType(row.taskType);
  const model = backgroundActivityModel(row);
  return (
    <>
      <Icon
        name={isAgent ? "UserRoundPlus" : "Terminal"}
        className={activityIconClass("active", "size-3.5 shrink-0")}
        aria-hidden="true"
      />
      <span
        className="min-w-0 truncate text-foreground"
        title={row.description}
      >
        {row.description}
      </span>
      {model ? (
        <span
          className="shrink-0 font-mono text-2xs text-subtle-foreground"
          title={`Model: ${model}`}
        >
          {model}
        </span>
      ) : null}
      <span className="shrink-0 whitespace-nowrap tabular-nums text-subtle-foreground">
        {showDuration ? <LiveDurationText startedAt={row.startedAt} /> : null}
      </span>
    </>
  );
}

interface ThreadBackgroundCommandsCardProps {
  commands: TimelineWorkflowWorkRow[];
  isExpanded: boolean;
  onToggle: () => void;
}

export function ThreadBackgroundCommandsCard({
  commands,
  isExpanded,
  onToggle,
}: ThreadBackgroundCommandsCardProps) {
  const olderListId = useId();
  const [hasOpenedOlder, setHasOpenedOlder] = useState(isExpanded);
  const keepsOlderRows = commands.length > 1 && (hasOpenedOlder || isExpanded);
  if (keepsOlderRows !== hasOpenedOlder) {
    setHasOpenedOlder(keepsOlderRows);
  }
  const newest = commands[0];
  if (!newest) {
    return null;
  }
  const older = commands.slice(1).reverse();
  const groupLabel = backgroundActivityGroupLabel(commands);
  const newestModel = backgroundActivityModel(newest);

  return (
    <PromptStackCard
      ariaLabel={groupLabel}
      className="overflow-hidden bg-background shadow-xs"
    >
      {older.length === 0 ? (
        <div className={ROW_CLASS}>
          <BackgroundActivityRow row={newest} showDuration />
        </div>
      ) : (
        <>
          <div
            aria-hidden={!isExpanded}
            inert={!isExpanded}
            className={cn(
              "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <ul
              id={olderListId}
              className="flex min-h-0 flex-col justify-end overflow-hidden"
            >
              {hasOpenedOlder
                ? older.map((row, index) => (
                    <li
                      key={row.id}
                      className={cn(
                        ROW_CLASS,
                        "shrink-0 transition-[opacity,translate] duration-200 ease-out starting:translate-y-1.5 starting:opacity-0 motion-reduce:transition-none",
                        isExpanded
                          ? "translate-y-0 opacity-100"
                          : "translate-y-1.5 opacity-0",
                      )}
                      style={
                        isExpanded
                          ? {
                              transitionDelay: `${(older.length - 1 - index) * OLDER_ROW_STAGGER_MS}ms`,
                            }
                          : undefined
                      }
                    >
                      <BackgroundActivityRow
                        row={row}
                        showDuration={isExpanded}
                      />
                    </li>
                  ))
                : null}
            </ul>
          </div>
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={olderListId}
            aria-label={`${groupLabel} (${commands.length}): ${newest.description}${newestModel ? ` · Model ${newestModel}` : ""}`}
            onClick={onToggle}
            className={cn(
              ROW_CLASS,
              "group/toggle cursor-pointer transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            <BackgroundActivityRow row={newest} showDuration />
            <span className="ml-auto inline-flex h-4.5 shrink-0 items-center gap-0.5 rounded-full bg-surface-recessed pr-1 pl-1.5 text-2xs leading-none tabular-nums text-muted-foreground transition-colors group-hover/toggle:bg-state-active group-hover/toggle:text-foreground">
              {commands.length}
              <Icon
                name="ChevronUp"
                className={cn(
                  "size-3 transition-transform duration-200 ease-out motion-reduce:transition-none",
                  isExpanded && "rotate-180",
                )}
                aria-hidden="true"
              />
            </span>
          </button>
        </>
      )}
    </PromptStackCard>
  );
}
