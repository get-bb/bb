import type { TimelineExecutionChange } from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/thread-creation-options/selection-state";
import { modelLabel } from "@/lib/model-label";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";

function executionModelLabel(model: string): string {
  return /^(?:anthropic[-/])?claude-/i.test(model)
    ? modelLabel(model)
    : formatModelLabel(model);
}

export function describeExecutionChange(
  change: TimelineExecutionChange,
): string {
  const modelChanged = change.from.model !== change.to.model;
  const reasoningChanged =
    change.from.reasoningLevel !== change.to.reasoningLevel;
  const describe = (side: TimelineExecutionChange["from"]) =>
    [
      modelChanged ? executionModelLabel(side.model) : null,
      reasoningChanged
        ? reasoningLevelLabel(side.reasoningLevel, undefined)
        : null,
    ]
      .filter((part) => part !== null)
      .join(" ");
  return `${describe(change.from)} → ${describe(change.to)}`;
}

export function ExecutionChangeDivider({
  change,
}: {
  change: TimelineExecutionChange;
}) {
  const label = describeExecutionChange(change);
  return (
    <div
      role="separator"
      aria-label={`Settings changed: ${label}`}
      className="flex items-center gap-2 px-2 py-1 text-2xs text-muted-foreground"
      data-testid="thread-execution-change-divider"
    >
      <span className="h-px min-w-0 flex-1 bg-border" aria-hidden />
      <span className="shrink-0">{label}</span>
      <span className="h-px min-w-0 flex-1 bg-border" aria-hidden />
    </div>
  );
}
