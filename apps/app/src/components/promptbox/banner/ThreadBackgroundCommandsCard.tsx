import { useLayoutEffect, useRef, useState } from "react";
import { isBackgroundAgentTaskType } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { LiveDurationText } from "@/components/thread/timeline/LiveDurationText";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { observeSharedResize } from "@bb/shared-ui/lib/shared-resize-observer";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackHoverChevron,
  useDisclosureFocusHandoff,
  AnimatedDisclosureBody,
} from "@bb/shared-ui/prompt-stack-disclosure";

const BODY_ID = "thread-background-commands-card-body";
const TOGGLE_ID = "thread-background-commands-card-toggle";
const COMPACT_PROMPT_SHELL_MAX_WIDTH_REM = 34;
const DEFAULT_ROOT_FONT_SIZE_PX = 16;

function isCompactPromptShellWidth(width: number): boolean {
  const parsedRootFontSize =
    typeof window === "undefined"
      ? Number.NaN
      : Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        );
  const rootFontSize = Number.isFinite(parsedRootFontSize)
    ? parsedRootFontSize
    : DEFAULT_ROOT_FONT_SIZE_PX;
  return width <= COMPACT_PROMPT_SHELL_MAX_WIDTH_REM * rootFontSize;
}

interface BackgroundActivityDisplay {
  icon: "Terminal" | "UserRoundPlus";
  label: string;
  runningPrefix: string;
}

function backgroundActivityDisplay(
  row: TimelineWorkflowWorkRow,
): BackgroundActivityDisplay {
  if (isBackgroundAgentTaskType(row.taskType)) {
    return {
      icon: "UserRoundPlus",
      label: "Background agent",
      runningPrefix: "Running background agent:",
    };
  }
  return {
    icon: "Terminal",
    label: "Background command",
    runningPrefix: "Running background command:",
  };
}

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

function backgroundActivityAriaLabel(
  row: TimelineWorkflowWorkRow,
  label = backgroundActivityDisplay(row).label,
): string {
  const model = backgroundActivityModel(row);
  return model
    ? `${label}: ${row.description} · Model ${model}`
    : `${label}: ${row.description}`;
}

function compactBackgroundActivityLabel(
  rows: readonly TimelineWorkflowWorkRow[],
): string {
  const agentCount = rows.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = rows.length - agentCount;
  if (commandCount === 0) {
    return `Running ${agentCount} background agent${agentCount === 1 ? "" : "s"}`;
  }
  if (agentCount === 0) {
    return `Running ${commandCount} background command${commandCount === 1 ? "" : "s"}`;
  }
  return `Running ${rows.length} background activities`;
}

function BackgroundActivitySummary({ row }: { row: TimelineWorkflowWorkRow }) {
  const display = backgroundActivityDisplay(row);
  const model = backgroundActivityModel(row);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span
        className={cn(
          "shrink-0 whitespace-nowrap",
          activityMetaClass("active"),
        )}
      >
        {display.runningPrefix}
      </span>
      <span
        className={cn("min-w-0 truncate", activityTextClass("active"))}
        title={row.description}
      >
        {row.description}
      </span>
      {model ? (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-2xs",
            activityMetaClass("active"),
          )}
          title={`Model: ${model}`}
        >
          {model}
        </span>
      ) : null}
    </span>
  );
}

function StopBackgroundActivityButton({
  row,
  onStop,
}: {
  row: TimelineWorkflowWorkRow;
  onStop: (row: TimelineWorkflowWorkRow) => void;
}) {
  const label = backgroundActivityDisplay(row).label.toLowerCase();
  return (
    <button
      type="button"
      className="relative cursor-pointer rounded-sm text-muted-foreground underline decoration-transparent underline-offset-2 transition-colors after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:text-destructive-text hover:decoration-current focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={`Stop ${label}: ${row.description}`}
      onClick={() => onStop(row)}
    >
      Stop
    </button>
  );
}

function BackgroundActivityTrailing({
  row,
  onStop,
}: {
  row: TimelineWorkflowWorkRow;
  onStop: (row: TimelineWorkflowWorkRow) => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-subtle-foreground">
      <span className="tabular-nums">
        <LiveDurationText startedAt={row.startedAt} />
      </span>
      {row.stoppable ? (
        <>
          <span aria-hidden="true">·</span>
          <StopBackgroundActivityButton row={row} onStop={onStop} />
        </>
      ) : null}
    </span>
  );
}

interface ThreadBackgroundCommandsCardProps {
  commands: TimelineWorkflowWorkRow[];
  isExpanded: boolean;
  onToggle: () => void;
  onStop: (row: TimelineWorkflowWorkRow) => void;
}

function readIsCompactCard(width: number): boolean | null {
  return width > 0 ? isCompactPromptShellWidth(width) : null;
}

export function ThreadBackgroundCommandsCard({
  commands,
  isExpanded,
  onToggle,
  onStop,
}: ThreadBackgroundCommandsCardProps) {
  const isCompactViewport = useIsCompactViewport();
  const cardRef = useRef<HTMLElement>(null);
  const [isCompactCard, setIsCompactCard] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (card === null || typeof ResizeObserver === "undefined") return;
    setIsCompactCard(readIsCompactCard(card.getBoundingClientRect().width));
    return observeSharedResize(card, {
      read: (entry) =>
        readIsCompactCard(
          entry?.borderBoxSize?.[0]?.inlineSize ??
            card.getBoundingClientRect().width,
        ),
      write: setIsCompactCard,
    });
  }, []);
  const { triggerRef, collapseRef, onTriggerClick, onCollapseClick } =
    useDisclosureFocusHandoff(isExpanded, onToggle);
  const newest = commands[0];
  if (!newest) {
    return null;
  }
  const isCompact = isCompactCard ?? isCompactViewport;
  const canExpand = commands.length > 1 || isCompact;
  const summaryLabel = compactBackgroundActivityLabel(commands);
  const showNewestInSummary = !isCompact && !isExpanded;
  const newestDisplay = backgroundActivityDisplay(newest);
  const groupLabel = backgroundActivityGroupLabel(commands);

  return (
    <PromptStackCard
      rootRef={cardRef}
      ariaLabel={groupLabel}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        className={activityRowClass(
          "active",
          "flex items-center rounded-none p-0",
        )}
      >
        {canExpand ? (
          <button
            type="button"
            id={TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={BODY_ID}
            aria-label={
              showNewestInSummary
                ? `${summaryLabel}: ${newest.description}`
                : summaryLabel
            }
            ref={triggerRef}
            onClick={onTriggerClick}
            className={cn(
              PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
              PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
            )}
          >
            <Icon
              name={newestDisplay.icon}
              className={activityIconClass("active", "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
              <span
                className={cn(
                  "min-w-0 truncate font-medium",
                  showNewestInSummary && "shrink-0",
                )}
              >
                {summaryLabel}
              </span>
              {showNewestInSummary ? (
                <>
                  <span
                    aria-hidden="true"
                    className={activityMetaClass("active")}
                  >
                    ·
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      activityMetaClass("active"),
                    )}
                    title={newest.description}
                  >
                    {newest.description}
                  </span>
                </>
              ) : null}
            </span>
            <PromptStackHoverChevron isExpanded={isExpanded} />
          </button>
        ) : (
          <div
            className="flex min-h-8 w-full min-w-0 cursor-default items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground"
            aria-label={backgroundActivityAriaLabel(newest)}
          >
            <Icon
              name={newestDisplay.icon}
              className={activityIconClass("active", "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            <BackgroundActivitySummary row={newest} />
            <BackgroundActivityTrailing row={newest} onStop={onStop} />
          </div>
        )}
      </div>
      {canExpand ? (
        <AnimatedDisclosureBody
          id={BODY_ID}
          labelledBy={TOGGLE_ID}
          isExpanded={isExpanded}
          collapsedBorder="none"
          collapseLabel={`Collapse ${groupLabel.toLowerCase()}`}
          collapseRef={collapseRef}
          onCollapse={onCollapseClick}
        >
          <div className="flex flex-col gap-0.5 py-1">
            {commands.map((row) => {
              const display = backgroundActivityDisplay(row);
              const model = backgroundActivityModel(row);
              return (
                <div
                  key={row.id}
                  className={cn(
                    "flex min-w-0 gap-1.5 px-3 py-0.5 text-xs",
                    isCompact ? "items-start" : "items-center",
                  )}
                >
                  <span className="flex h-[1lh] shrink-0 items-center">
                    <Icon
                      name={display.icon}
                      className="size-3.5 text-muted-foreground/60"
                      aria-hidden="true"
                    />
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-muted-foreground",
                      isCompact ? "line-clamp-2 break-all" : "truncate",
                    )}
                    title={row.description}
                  >
                    {row.description}
                  </span>
                  {model ? (
                    <span
                      className="shrink-0 whitespace-nowrap font-mono text-2xs text-subtle-foreground"
                      title={`Model: ${model}`}
                    >
                      {model}
                    </span>
                  ) : null}
                  {isExpanded ? (
                    <BackgroundActivityTrailing row={row} onStop={onStop} />
                  ) : null}
                </div>
              );
            })}
          </div>
        </AnimatedDisclosureBody>
      ) : null}
    </PromptStackCard>
  );
}
