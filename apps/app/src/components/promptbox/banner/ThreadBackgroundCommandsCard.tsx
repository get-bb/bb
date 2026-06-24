import { useEffect, useState } from "react";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { durationToCompactString } from "@bb/thread-view";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { Icon } from "@/components/ui/icon.js";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
} from "@/components/ui/activity-row-styles";
import { cn } from "@/lib/utils";

const CARD_ROW_HEIGHT = 32;
const BODY_ID = "thread-background-commands-card-body";
const TOGGLE_ID = "thread-background-commands-card-toggle";

/**
 * Live elapsed time since the command started, ticking every second. Blank for
 * the first second to avoid sub-second flicker on entry. Mirrors the workflow
 * card's duration treatment.
 */
function CommandDuration({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  useEffect(() => {
    setElapsed(Date.now() - startedAt);
    const interval = window.setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  if (elapsed <= 1_000) {
    return null;
  }
  return <>{durationToCompactString(elapsed)}</>;
}

function CommandSummary({
  row,
  showDuration,
  active = false,
}: {
  row: TimelineWorkflowWorkRow;
  showDuration: boolean;
  active?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 text-left">
      {/* Verb + description truncate as one unit so the trailing controls
          ("+N more", chevron, duration) never get pushed off a narrow banner. */}
      <span className="min-w-0 truncate" title={row.description}>
        <span
          className={
            active ? activityMetaClass("active") : "text-muted-foreground"
          }
        >
          Running background command:{" "}
        </span>
        <span
          className={
            active
              ? activityTextClass("active")
              : "font-medium text-foreground opacity-70"
          }
        >
          {row.description}
        </span>
      </span>
      {showDuration ? (
        <span
          className={cn(
            "shrink-0",
            active ? activityMetaClass("active") : "text-muted-foreground",
          )}
        >
          <CommandDuration startedAt={row.startedAt} />
        </span>
      ) : null}
    </span>
  );
}

export interface ThreadBackgroundCommandsCardProps {
  commands: TimelineWorkflowWorkRow[];
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * Prompt-stack card for running backgrounded shell commands (Bash
 * run_in_background), independent of the workflow card. Collapsed it shows the
 * most recent command; when several are running it appends "+N more" and the
 * card expands to list the other running commands. Each command also keeps its
 * own timeline row carrying the terminal outcome; this card only tracks the
 * live ones and drops out once none remain.
 */
export function ThreadBackgroundCommandsCard({
  commands,
  isExpanded,
  onToggle,
}: ThreadBackgroundCommandsCardProps) {
  const primary = commands[0];
  if (!primary) {
    return null;
  }
  const others = commands.slice(1);
  const hasMore = others.length > 0;

  return (
    <PromptStackCard
      ariaLabel="Background commands"
      className="overflow-hidden"
      style={{ minHeight: CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
        {hasMore ? (
          <button
            type="button"
            id={TOGGLE_ID}
            aria-expanded={isExpanded}
            aria-controls={BODY_ID}
            aria-label={`Background commands: ${primary.description}`}
            onClick={onToggle}
            className={activityRowClass(
              "active",
              "flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80",
            )}
          >
            <Icon
              name="Terminal"
              className={activityIconClass("active", "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            <CommandSummary row={primary} showDuration={false} active />
            <span className={activityMetaClass("active", "shrink-0")}>
              +{others.length} more
            </span>
            <Icon
              name="ChevronDown"
              className={cn(
                activityIconClass("active"),
                "size-3.5 shrink-0 transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <div
            className={activityRowClass(
              "active",
              "flex min-h-8 w-full min-w-0 cursor-default items-center gap-1.5 rounded-none px-3 py-1.5 text-xs text-foreground",
            )}
            aria-label={`Background command: ${primary.description}`}
          >
            <Icon
              name="Terminal"
              className={activityIconClass("active", "size-3.5 shrink-0")}
              aria-hidden="true"
            />
            <CommandSummary row={primary} showDuration active />
          </div>
        )}
      </div>
      {hasMore ? (
        <section
          id={BODY_ID}
          role="region"
          aria-labelledby={TOGGLE_ID}
          aria-hidden={!isExpanded}
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
            isExpanded
              ? "grid-rows-[1fr] border-t border-border opacity-100"
              : "pointer-events-none grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="overflow-hidden bg-popover">
            <div className="flex flex-col gap-0.5 py-1">
              {others.map((row) => (
                <div
                  key={row.id}
                  // px-3 matches the full-width header row's padding so the
                  // icon lines up under the header icon.
                  className="flex min-w-0 items-center gap-1.5 px-3 py-0.5 text-xs"
                >
                  <Icon
                    name="Terminal"
                    className="size-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-muted-foreground"
                    title={row.description}
                  >
                    {row.description}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-subtle-foreground">
                    <CommandDuration startedAt={row.startedAt} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </PromptStackCard>
  );
}
