import {
  isBackgroundAgentTaskType,
  isSettledWorkflowAgentState,
  type ThreadTimelineActivePromptMode,
  type ThreadTimelineGoal,
  type ThreadTimelineModelFallback,
  type ThreadTimelinePendingTodoItemStatus,
  type ThreadTimelinePendingTodos,
} from "@bb/domain";
import type {
  ThreadContextWindowUsage,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { durationToCompactString } from "@bb/thread-view";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Spinner, Text, type IconName } from "@/ui";
import {
  WorkflowPhaseStrip,
  WorkflowProgressView,
  workflowBodyKind,
} from "../timeline/renderers/work";
import {
  calculateContextWindowUsagePercent,
  contextWindowTone,
  formatCompactTokenCount,
  formatGoalDuration,
  formatGoalTokenUsage,
  modelFallbackLabel,
  sortTodoItems,
  summarizeTodoItems,
} from "./cards-model";

/**
 * Ports of the web prompt-stack cards
 * (apps/app/src/components/promptbox/banner/*): running workflows,
 * background commands / agents, plan mode (Exit), goal (Clear), to-dos,
 * model fallback. Each is a collapsible row above the composer.
 */

interface PromptStackCardAction {
  label: string;
  onPress: () => void;
  pending: boolean;
  testID?: string;
}

interface PromptStackCardProps {
  icon: IconName;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** Trailing "X" action (exit plan mode / clear goal). */
  action?: PromptStackCardAction | null;
  /** Rendered under the header row while collapsed (workflow phase strip). */
  belowHeader?: ReactNode;
  /** Shimmer the label (a live activity). */
  live?: boolean;
  children: ReactNode;
  testID?: string;
}

function PromptStackCard({
  icon,
  label,
  expanded,
  onToggle,
  action,
  belowHeader,
  live = false,
  children,
  testID,
}: PromptStackCardProps) {
  const { tokens } = useTheme();
  return (
    <View
      className="overflow-hidden rounded-md border border-border bg-surface-raised-solid"
      testID={testID}
    >
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={onToggle}
          className="min-h-8 min-w-0 flex-1 flex-row items-center gap-1.5 px-3 py-1.5 active:bg-state-hover"
        >
          <Icon
            name={icon}
            size={14}
            color={live ? tokens.mutedForeground : tokens.foreground}
          />
          <Text
            className={cn(
              "min-w-0 flex-1 text-xs",
              live && "text-muted-foreground",
            )}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Icon
            name={expanded ? "ChevronUp" : "ChevronDown"}
            size={14}
            color={tokens.mutedForeground}
          />
        </Pressable>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.pending }}
            disabled={action.pending}
            onPress={action.onPress}
            className="h-8 w-8 items-center justify-center border-l border-border active:bg-state-hover"
            testID={action.testID}
          >
            {action.pending ? (
              <Spinner size="small" color={tokens.mutedForeground} />
            ) : (
              <Icon name="X" size={14} color={tokens.mutedForeground} />
            )}
          </Pressable>
        ) : null}
      </View>
      {belowHeader}
      {expanded ? (
        <View className="border-t border-border bg-popover px-3 pb-2.5 pt-2">
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** Live elapsed time since `startedAt`, ticking every second (blank for the first second). */
function LiveDuration({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = now - startedAt;
  if (elapsed <= 1_000) return null;
  return <Text variant="caption">{durationToCompactString(elapsed)}</Text>;
}

function workflowAgentProgressLabel(
  workflow: TimelineWorkflowWorkRow,
): string | null {
  const agents = workflow.workflow?.agents ?? [];
  if (agents.length === 0) return null;
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return `${settled}/${agents.length} agents`;
}

/**
 * One running Workflow tool run (web ThreadWorkflowCard): name, agent
 * progress and live duration collapsed, the phase/agent tree expanded.
 * Drops out once the workflow settles (its timeline row keeps the outcome).
 */
export function ThreadWorkflowCard({
  workflow,
}: {
  workflow: TimelineWorkflowWorkRow;
}) {
  const [expanded, setExpanded] = useState(false);
  if (workflow.status !== "pending") return null;
  const name = workflow.workflowName ?? workflow.description;
  const progress = workflowAgentProgressLabel(workflow);
  const body = workflowBodyKind(workflow);
  return (
    <PromptStackCard
      icon="Workflow"
      label={progress ? `${name} · ${progress}` : name}
      live
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      belowHeader={
        body.kind === "tree" ? (
          <View className="px-3 pb-2">
            <WorkflowPhaseStrip progress={body.snapshot} settled={false} />
          </View>
        ) : null
      }
      testID="thread-card-workflow"
    >
      <View className="flex-row items-center justify-between gap-2 pb-1">
        <Text variant="caption" numberOfLines={1} className="min-w-0 flex-1">
          {workflow.description}
        </Text>
        <LiveDuration startedAt={workflow.startedAt} />
      </View>
      {body.kind === "tree" ? (
        <WorkflowProgressView
          progress={body.snapshot}
          settled={false}
          error={workflow.error}
        />
      ) : body.kind === "text" ? (
        <Text variant="caption">{body.text}</Text>
      ) : null}
    </PromptStackCard>
  );
}

function backgroundActivityLabel(
  commands: readonly TimelineWorkflowWorkRow[],
): string {
  const agentCount = commands.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = commands.length - agentCount;
  if (commandCount === 0) {
    return `Running ${agentCount} background agent${agentCount === 1 ? "" : "s"}`;
  }
  if (agentCount === 0) {
    return `Running ${commandCount} background command${commandCount === 1 ? "" : "s"}`;
  }
  return `Running ${commands.length} background activities`;
}

/**
 * Live backgrounded commands / agents that are not workflows (web
 * ThreadBackgroundCommandsCard, compact layout): a count collapsed, one
 * line per task (description, model, live duration) expanded.
 */
export function ThreadBackgroundCommandsCard({
  commands,
}: {
  commands: readonly TimelineWorkflowWorkRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { tokens } = useTheme();
  if (commands.length === 0) return null;
  return (
    <PromptStackCard
      icon="Terminal"
      label={backgroundActivityLabel(commands)}
      live
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      testID="thread-card-background-commands"
    >
      <View className="gap-1.5">
        {commands.map((row) => {
          const isAgent = isBackgroundAgentTaskType(row.taskType);
          return (
            <View key={row.id} className="flex-row items-center gap-2">
              <Icon
                name={isAgent ? "UserRoundPlus" : "Terminal"}
                size={14}
                color={tokens.mutedForeground}
              />
              <Text
                className="min-w-0 flex-1 text-xs"
                numberOfLines={1}
                accessibilityLabel={`${isAgent ? "Background agent" : "Background command"}: ${row.description}`}
              >
                {row.description}
              </Text>
              {isAgent && row.model ? (
                <Text variant="chrome" mono tone="subtle" numberOfLines={1}>
                  {row.model}
                </Text>
              ) : null}
              <LiveDuration startedAt={row.startedAt} />
            </View>
          );
        })}
      </View>
    </PromptStackCard>
  );
}

export function ThreadPromptModeCard({
  activePromptMode,
  onExitPlanMode,
  isExitPending = false,
}: {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  /** "Exit plan mode" (`POST /threads/:id/plan/cancel`); omit for read-only. */
  onExitPlanMode?: () => void;
  isExitPending?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (activePromptMode?.mode !== "plan") return null;
  const prompt = activePromptMode.prompt.trim();
  return (
    <PromptStackCard
      icon="ListTodo"
      label="Plan"
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      action={
        onExitPlanMode
          ? {
              label: "Exit plan mode",
              onPress: onExitPlanMode,
              pending: isExitPending,
              testID: "thread-card-plan-exit",
            }
          : null
      }
      testID="thread-card-plan"
    >
      <Text className="text-xs text-foreground/90">
        {prompt.length > 0 ? prompt : "Plan mode is active."}
      </Text>
    </PromptStackCard>
  );
}

export function ThreadGoalCard({
  goal,
  onClearGoal,
  isClearPending = false,
}: {
  goal: ThreadTimelineGoal | null;
  /** "Clear goal" (`POST /threads/:id/goal/clear`); omit for read-only. */
  onClearGoal?: () => void;
  isClearPending?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { tokens } = useTheme();
  if (!goal || goal.status !== "active") return null;
  const objective = goal.objective.trim();
  return (
    <PromptStackCard
      icon="Target"
      label="Goal"
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      action={
        onClearGoal
          ? {
              label: "Clear goal",
              onPress: onClearGoal,
              pending: isClearPending,
              testID: "thread-card-goal-clear",
            }
          : null
      }
      testID="thread-card-goal"
    >
      <Text className="text-xs text-foreground/90">
        {objective.length > 0 ? objective : "No goal objective."}
      </Text>
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 pt-2">
        <View className="flex-row items-center gap-1.5">
          <Icon name="Zap" size={14} color={tokens.mutedForeground} />
          <Text variant="caption">{formatGoalTokenUsage(goal)}</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <Icon name="Clock" size={14} color={tokens.mutedForeground} />
          <Text variant="caption">
            {formatGoalDuration(goal.timeUsedSeconds)}
          </Text>
        </View>
      </View>
    </PromptStackCard>
  );
}

function todoIcon(status: ThreadTimelinePendingTodoItemStatus): IconName {
  return status === "completed" ? "Check" : "Square";
}

export function ThreadTodoCard({
  pendingTodos,
}: {
  pendingTodos: ThreadTimelinePendingTodos | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { tokens } = useTheme();
  const items = pendingTodos?.items ?? [];
  if (items.length === 0) return null;
  return (
    <PromptStackCard
      icon="ListTodo"
      label={summarizeTodoItems(items)}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
      testID="thread-card-todos"
    >
      <View className="gap-1">
        {sortTodoItems(items).map((item) => (
          <View key={item.id} className="flex-row items-center gap-2">
            <Icon
              name={todoIcon(item.status)}
              size={14}
              color={
                item.status === "in_progress"
                  ? tokens.foreground
                  : tokens.mutedForeground
              }
            />
            <Text
              className={cn(
                "min-w-0 flex-1 text-xs",
                item.status === "completed"
                  ? "text-muted-foreground line-through"
                  : item.status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground",
              )}
              numberOfLines={2}
            >
              {item.text}
            </Text>
          </View>
        ))}
      </View>
    </PromptStackCard>
  );
}

export function ThreadModelFallbackCard({
  fallback,
}: {
  fallback: ThreadTimelineModelFallback | null;
}) {
  const { tokens } = useTheme();
  // Dismissal is per occurrence (`sourceSeq`); a new fallback shows again.
  const [dismissedSourceSeq, setDismissedSourceSeq] = useState<number | null>(
    null,
  );
  if (!fallback || dismissedSourceSeq === fallback.sourceSeq) return null;
  return (
    <View
      accessibilityRole="alert"
      className="flex-row items-center gap-2 rounded-md border border-border bg-surface-attention px-3 py-2"
      testID="thread-card-model-fallback"
    >
      <Icon name="AlertTriangle" size={14} color={tokens.warningText} />
      <View className="min-w-0 flex-1">
        <Text className="text-xs font-medium">Model fallback</Text>
        <Text variant="caption" numberOfLines={2}>
          Switched from {modelFallbackLabel(fallback.originalModel)} to{" "}
          {modelFallbackLabel(fallback.fallbackModel)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss model fallback"
        onPress={() => setDismissedSourceSeq(fallback.sourceSeq)}
        className="h-8 w-8 items-center justify-center rounded-md active:bg-state-hover"
      >
        <Icon name="X" size={14} color={tokens.mutedForeground} />
      </Pressable>
    </View>
  );
}

/** Compact "used / window" readout for the bottom bar. */
export function ThreadContextWindowIndicator({
  usage,
}: {
  usage: ThreadContextWindowUsage | undefined;
}) {
  const { tokens } = useTheme();
  if (!usage) return null;
  const percent = calculateContextWindowUsagePercent(usage);
  const tone = contextWindowTone(percent);
  const color =
    tone === "destructive"
      ? tokens.destructiveText
      : tone === "warning"
        ? tokens.warningText
        : tokens.mutedForeground;
  return (
    <View
      className="flex-row items-center gap-1.5"
      accessibilityLabel={`Context window ${percent}% used`}
      testID="thread-context-window"
    >
      <View
        className="h-1.5 w-12 overflow-hidden rounded-full bg-border-hairline"
        accessible={false}
      >
        <View
          style={{ width: `${percent}%`, backgroundColor: color }}
          className="h-full rounded-full"
        />
      </View>
      <Text variant="chrome" style={{ color }}>
        {`${formatCompactTokenCount(usage.usedTokens)} / ${formatCompactTokenCount(usage.modelContextWindow)}${usage.estimated ? " est." : ""}`}
      </Text>
    </View>
  );
}
