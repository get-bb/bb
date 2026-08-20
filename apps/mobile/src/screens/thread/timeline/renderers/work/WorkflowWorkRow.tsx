import { View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Text } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import {
  formatWorkflowUsage,
  workflowBodyKind,
  workflowStatusPillState,
  type WorkflowStatusPillState,
} from "./work-row-model";
import {
  WorkflowPhaseStrip,
  WorkflowProgressView,
} from "./WorkflowProgressView";
import { WorkRowShell } from "./WorkRowShell";

const STATUS_PILL_LABEL: Record<WorkflowStatusPillState, string> = {
  queued: "Queued",
  completed: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Web `WorkflowStatusPill`: compact terminal-state chip. */
function WorkflowStatusPill({ state }: { state: WorkflowStatusPillState }) {
  const { tokens } = useTheme();
  const icon =
    state === "completed"
      ? "Check"
      : state === "failed"
        ? "X"
        : state === "cancelled"
          ? "Pause"
          : null;
  const color =
    state === "completed"
      ? tokens.success
      : state === "failed"
        ? tokens.destructiveText
        : state === "cancelled"
          ? tokens.subtleForeground
          : tokens.mutedForeground;
  return (
    <View
      className={cn(
        "flex-row items-center gap-1 self-start rounded-full px-2 py-0.5",
        state === "completed"
          ? "bg-success/10"
          : state === "failed"
            ? "bg-destructive/10"
            : "bg-surface-recessed",
      )}
      testID={`timeline-workflow-status-${state}`}
    >
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text variant="chrome" weight="medium" style={{ color }}>
        {STATUS_PILL_LABEL[state]}
      </Text>
    </View>
  );
}

/**
 * `work:workflow` (background task: Workflow tool run, backgrounded command
 * or agent): title (verb by task type + name, agent progress, duration), a
 * per-phase strip while a workflow snapshot exists, and — expanded — the
 * phase/agent tree (or the terminal summary / error for degraded rows),
 * the terminal status chip, and usage (tokens · tools · duration). Running
 * workflows auto-open so live agent progress stays visible.
 */
export function WorkflowWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:workflow">) {
  const row = item.row;
  const settled = row.status !== "pending";
  const body = workflowBodyKind(row);
  const pill = workflowStatusPillState(row.taskStatus);
  const usage = formatWorkflowUsage(row.usage);
  const strip =
    body.kind === "tree" ? (
      <View className="pb-1.5 pl-5 pr-6">
        <WorkflowPhaseStrip progress={body.snapshot} settled={settled} />
      </View>
    ) : null;
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
      belowHeader={strip}
    >
      <View className="gap-2 pl-5">
        {body.kind === "tree" ? (
          <WorkflowProgressView
            progress={body.snapshot}
            settled={settled}
            error={row.error}
            testID="timeline-workflow-progress"
          />
        ) : body.kind === "text" ? (
          <Text variant="caption" testID="timeline-workflow-summary">
            {body.text}
          </Text>
        ) : null}
        {pill !== null || usage !== null ? (
          <View className="flex-row flex-wrap items-center gap-2">
            {pill !== null ? <WorkflowStatusPill state={pill} /> : null}
            {usage !== null ? (
              <Text
                variant="chrome"
                mono
                tone="subtle"
                testID="timeline-workflow-usage"
              >
                {usage}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </WorkRowShell>
  );
}
