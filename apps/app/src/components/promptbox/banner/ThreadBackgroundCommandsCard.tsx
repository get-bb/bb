import { useRef, useState } from "react";
import { isBackgroundAgentTaskType } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { useResizeObserver } from "usehooks-ts";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { LiveDurationText } from "@/components/thread/timeline/LiveDurationText";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
} from "@bb/shared-ui/activity-row-styles";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
  PromptStackCountSlot,
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
  offlinePrefix: string;
}

const MACHINE_OFFLINE_SUFFIX = ", machine offline";

function backgroundActivityDisplay(
  row: TimelineWorkflowWorkRow,
): BackgroundActivityDisplay {
  if (isBackgroundAgentTaskType(row.taskType)) {
    return {
      icon: "UserRoundPlus",
      label: "Background agent",
      runningPrefix: "Running background agent:",
      offlinePrefix: `Background agent${MACHINE_OFFLINE_SUFFIX}:`,
    };
  }
  return {
    icon: "Terminal",
    label: "Background command",
    runningPrefix: "Running background command:",
    offlinePrefix: `Background command${MACHINE_OFFLINE_SUFFIX}:`,
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

function compactBackgroundActivityCount(
  rows: readonly TimelineWorkflowWorkRow[],
): string {
  const agentCount = rows.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = rows.length - agentCount;
  if (commandCount === 0) {
    return `${agentCount} background agent${agentCount === 1 ? "" : "s"}`;
  }
  if (agentCount === 0) {
    return `${commandCount} background command${commandCount === 1 ? "" : "s"}`;
  }
  return `${rows.length} background activities`;
}

function compactBackgroundActivityLabel(
  rows: readonly TimelineWorkflowWorkRow[],
  hostUnavailable: boolean,
): string {
  const count = compactBackgroundActivityCount(rows);
  return hostUnavailable
    ? `${count}${MACHINE_OFFLINE_SUFFIX}`
    : `Running ${count}`;
}

function BackgroundActivitySummary({
  row,
  showDuration,
  hostUnavailable,
}: {
  row: TimelineWorkflowWorkRow;
  showDuration: boolean;
  hostUnavailable: boolean;
}) {
  const display = backgroundActivityDisplay(row);
  const model = backgroundActivityModel(row);
  const state = hostUnavailable ? "pending" : "active";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      <span
        className={cn("shrink-0 whitespace-nowrap", activityMetaClass(state))}
      >
        {hostUnavailable ? display.offlinePrefix : display.runningPrefix}
      </span>
      <span
        className={cn("min-w-0 truncate", activityTextClass(state))}
        title={row.description}
      >
        {row.description}
      </span>
      {model ? (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono text-2xs",
            activityMetaClass(state),
          )}
          title={`Model: ${model}`}
        >
          {model}
        </span>
      ) : null}
      {showDuration && !hostUnavailable ? (
        <span className={cn("shrink-0 tabular-nums", activityMetaClass(state))}>
          <LiveDurationText startedAt={row.startedAt} />
        </span>
      ) : null}
    </span>
  );
}

interface ThreadBackgroundCommandsCardProps {
  commands: TimelineWorkflowWorkRow[];
  hostUnavailable: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ThreadBackgroundCommandsCard({
  commands,
  hostUnavailable,
  isExpanded,
  onToggle,
}: ThreadBackgroundCommandsCardProps) {
  const isCompactViewport = useIsCompactViewport();
  const cardRef = useRef<HTMLElement>(null!);
  const [isCompactCard, setIsCompactCard] = useState<boolean | null>(null);
  const focus = useDisclosureFocusHandoff(isExpanded, onToggle);
  useResizeObserver({
    ref: cardRef,
    box: "border-box",
    onResize: ({ width }) => {
      if (width === undefined) return;
      const nextIsCompact = isCompactPromptShellWidth(width);
      setIsCompactCard((previous) =>
        previous === nextIsCompact ? previous : nextIsCompact,
      );
    },
  });
  const primary = commands[0];
  if (!primary) {
    return null;
  }
  const others = commands.slice(1);
  const hasMore = others.length > 0;
  const useCompactSummary = isCompactCard ?? isCompactViewport;
  const canExpand = hasMore || useCompactSummary;
  const expandedRows = useCompactSummary ? commands : others;
  const compactLabel = compactBackgroundActivityLabel(
    commands,
    hostUnavailable,
  );
  const primaryDisplay = backgroundActivityDisplay(primary);
  const groupLabel = backgroundActivityGroupLabel(commands);
  const ariaSuffix = hostUnavailable ? MACHINE_OFFLINE_SUFFIX : "";
  const activityState = hostUnavailable ? "pending" : "active";

  return (
    <PromptStackCard
      rootRef={cardRef}
      ariaLabel={groupLabel}
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
        {canExpand ? (
          <button
            type="button"
            id={TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={BODY_ID}
            aria-label={
              useCompactSummary
                ? compactLabel
                : backgroundActivityAriaLabel(
                    primary,
                    `${groupLabel}${ariaSuffix}`,
                  )
            }
            ref={focus.triggerRef}
            onClick={focus.onTriggerClick}
            className={activityRowClass(
              "active",
              cn(
                PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
                PROMPT_STACK_DISCLOSURE_TRIGGER_CLASS,
              ),
            )}
          >
            <Icon
              name={primaryDisplay.icon}
              className={activityIconClass(activityState, "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            {useCompactSummary ? (
              <>
                <span className="min-w-0 flex-1 truncate text-left font-medium">
                  {compactLabel}
                </span>
                <PromptStackHoverChevron isExpanded={isExpanded} />
              </>
            ) : (
              <>
                <BackgroundActivitySummary
                  row={primary}
                  showDuration={false}
                  hostUnavailable={hostUnavailable}
                />
                <PromptStackCountSlot count={commands.length} />
              </>
            )}
          </button>
        ) : (
          <div
            className={activityRowClass(
              "active",
              "flex min-h-8 w-full min-w-0 cursor-default items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground",
            )}
            aria-label={backgroundActivityAriaLabel(
              primary,
              `${primaryDisplay.label}${ariaSuffix}`,
            )}
          >
            <Icon
              name={primaryDisplay.icon}
              className={activityIconClass(activityState, "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            <BackgroundActivitySummary
              row={primary}
              showDuration
              hostUnavailable={hostUnavailable}
            />
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
          collapseRef={focus.collapseRef}
          onCollapse={focus.onCollapseClick}
        >
          <div className="flex flex-col gap-0.5 py-1">
            {expandedRows.map((row) => {
              const display = backgroundActivityDisplay(row);
              const model = backgroundActivityModel(row);
              return (
                <div
                  key={row.id}
                  className={cn(
                    "flex min-w-0 gap-1.5 px-3 py-0.5 text-xs",
                    useCompactSummary ? "items-start" : "items-center",
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
                      useCompactSummary ? "line-clamp-2 break-all" : "truncate",
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
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-subtle-foreground">
                    {isExpanded && !hostUnavailable ? (
                      <LiveDurationText startedAt={row.startedAt} />
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </AnimatedDisclosureBody>
      ) : null}
    </PromptStackCard>
  );
}
