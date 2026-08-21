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
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import type { ChildThreadPendingAttention } from "@/data/interactions";
import { useTheme } from "@/theme";
import { cn, Icon, Text, type IconName } from "@/ui";
import {
  hasThreadContextChips,
  ThreadChangesChip,
  ThreadChildThreadsChip,
  ThreadPullRequestChip,
  ThreadRelatedThreadChip,
  ThreadStatusChip,
  type ThreadContextChipsProps,
} from "../context/ThreadContextChips";
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
 * The phone's take on the web prompt-stack cards
 * (apps/app/src/components/promptbox/banner/*) and the context banner:
 * running workflows, background commands / agents, changed files, pull
 * request, plan mode (Exit), goal (Clear), to-dos, model fallback, related
 * and child threads, archive state. The web stacks one collapsible card per
 * item above the composer; on a phone that many cards push the timeline off
 * the screen, so each item is a chip in one horizontal row instead, and a
 * tap opens a bottom sheet with the detail the web card shows expanded.
 */

import { PromptChip } from "./PromptChip";

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

/** One workflow inside the Workflows sheet: header, phase strip, agent tree. */
function WorkflowSheetSection({
  workflow,
  first,
}: {
  workflow: TimelineWorkflowWorkRow;
  first: boolean;
}) {
  const { tokens } = useTheme();
  const name = workflow.workflowName ?? workflow.description;
  const progress = workflowAgentProgressLabel(workflow);
  const body = workflowBodyKind(workflow);
  return (
    <View
      className={cn("gap-2 py-3", !first && "border-t border-border-hairline")}
      testID={`thread-chip-workflow-${workflow.id}`}
    >
      <View className="flex-row items-center gap-2">
        <Icon name="Workflow" size={14} color={tokens.mutedForeground} />
        <Text variant="label" numberOfLines={1} className="min-w-0 flex-1">
          {name}
        </Text>
        {progress ? <Text variant="caption">{progress}</Text> : null}
        <LiveDuration startedAt={workflow.startedAt} />
      </View>
      {workflow.workflowName ? (
        <Text variant="caption" numberOfLines={2}>
          {workflow.description}
        </Text>
      ) : null}
      {body.kind === "tree" ? (
        <>
          <WorkflowPhaseStrip progress={body.snapshot} settled={false} />
          <WorkflowProgressView
            progress={body.snapshot}
            settled={false}
            error={workflow.error}
          />
        </>
      ) : body.kind === "text" ? (
        <Text variant="caption">{body.text}</Text>
      ) : null}
    </View>
  );
}

/**
 * Running Workflow tool runs (web ThreadWorkflowCard, one per workflow):
 * a single chip named after the workflow (or counting them), the sheet
 * lists each with its phase strip and agent tree. A workflow drops out
 * once it settles (its timeline row keeps the outcome).
 */
export function ThreadWorkflowsChip({
  workflows,
}: {
  workflows: readonly TimelineWorkflowWorkRow[];
}) {
  const running = workflows.filter((workflow) => workflow.status === "pending");
  if (running.length === 0) return null;
  const single = running.length === 1 ? running[0] : null;
  return (
    <PromptChip
      icon="Workflow"
      live
      label={
        single
          ? (single.workflowName ?? single.description)
          : `${running.length} workflows`
      }
      detail={
        single ? (workflowAgentProgressLabel(single) ?? undefined) : undefined
      }
      title={single ? "Workflow" : "Workflows"}
      testID="thread-chip-workflows"
    >
      {running.map((workflow, index) => (
        <WorkflowSheetSection
          key={workflow.id}
          workflow={workflow}
          first={index === 0}
        />
      ))}
    </PromptChip>
  );
}

/**
 * Chip copy and glyph: "2 commands" (terminal), "1 agent" (add-user, the
 * web card's agent glyph), "3 tasks" (terminal) for a mix.
 */
function backgroundActivityDisplay(
  commands: readonly TimelineWorkflowWorkRow[],
): { label: string; icon: IconName } {
  const agentCount = commands.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = commands.length - agentCount;
  if (commandCount === 0) {
    return {
      label: `${agentCount} agent${agentCount === 1 ? "" : "s"}`,
      icon: "UserRoundPlus",
    };
  }
  if (agentCount === 0) {
    return {
      label: `${commandCount} command${commandCount === 1 ? "" : "s"}`,
      icon: "Terminal",
    };
  }
  return { label: `${commands.length} tasks`, icon: "Terminal" };
}

/**
 * Live backgrounded commands / agents that are not workflows (web
 * ThreadBackgroundCommandsCard): a count on the chip, one line per task
 * (description, model, live duration) in the sheet.
 */
export function ThreadBackgroundCommandsChip({
  commands,
}: {
  commands: readonly TimelineWorkflowWorkRow[];
}) {
  const { tokens } = useTheme();
  if (commands.length === 0) return null;
  const display = backgroundActivityDisplay(commands);
  return (
    <PromptChip
      icon={display.icon}
      live
      label={display.label}
      title="Background activity"
      testID="thread-chip-background-commands"
    >
      <View className="gap-2 py-1">
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
                className="min-w-0 flex-1 text-sm"
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
    </PromptChip>
  );
}

export function ThreadPromptModeChip({
  activePromptMode,
  onExitPlanMode,
  isExitPending = false,
}: {
  activePromptMode: ThreadTimelineActivePromptMode | null;
  /** "Exit plan mode" (`POST /threads/:id/plan/cancel`); omit for read-only. */
  onExitPlanMode?: () => void;
  isExitPending?: boolean;
}) {
  if (activePromptMode?.mode !== "plan") return null;
  const prompt = activePromptMode.prompt.trim();
  return (
    <PromptChip
      icon="ListTodo"
      label="Plan"
      action={
        onExitPlanMode
          ? {
              label: "Exit plan mode",
              onPress: onExitPlanMode,
              pending: isExitPending,
              testID: "thread-chip-plan-exit",
            }
          : null
      }
      title="Plan mode"
      testID="thread-chip-plan"
    >
      <Text className="text-sm text-foreground/90">
        {prompt.length > 0 ? prompt : "Plan mode is active."}
      </Text>
    </PromptChip>
  );
}

export function ThreadGoalChip({
  goal,
  onClearGoal,
  isClearPending = false,
}: {
  goal: ThreadTimelineGoal | null;
  /** "Clear goal" (`POST /threads/:id/goal/clear`); omit for read-only. */
  onClearGoal?: () => void;
  isClearPending?: boolean;
}) {
  const { tokens } = useTheme();
  if (!goal || goal.status !== "active") return null;
  const objective = goal.objective.trim();
  return (
    <PromptChip
      icon="Target"
      label="Goal"
      action={
        onClearGoal
          ? {
              label: "Clear goal",
              onPress: onClearGoal,
              pending: isClearPending,
              testID: "thread-chip-goal-clear",
            }
          : null
      }
      title="Goal"
      testID="thread-chip-goal"
    >
      <Text className="text-sm text-foreground/90">
        {objective.length > 0 ? objective : "No goal objective."}
      </Text>
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1 pt-3">
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
    </PromptChip>
  );
}

function todoIcon(status: ThreadTimelinePendingTodoItemStatus): IconName {
  return status === "completed" ? "Check" : "Square";
}

export function ThreadTodoChip({
  pendingTodos,
}: {
  pendingTodos: ThreadTimelinePendingTodos | null;
}) {
  const { tokens } = useTheme();
  const items = pendingTodos?.items ?? [];
  if (items.length === 0) return null;
  return (
    <PromptChip
      icon="ListTodo"
      label="To-dos"
      detail={summarizeTodoItems(items)}
      title="To-dos"
      testID="thread-chip-todos"
    >
      <View className="gap-2 py-1">
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
                "min-w-0 flex-1 text-sm",
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
    </PromptChip>
  );
}

export interface ThreadPromptChipsProps {
  workflows: readonly TimelineWorkflowWorkRow[];
  backgroundCommands: readonly TimelineWorkflowWorkRow[];
  activePromptMode: ThreadTimelineActivePromptMode | null;
  onExitPlanMode?: () => void;
  isExitPending?: boolean;
  goal: ThreadTimelineGoal | null;
  onClearGoal?: () => void;
  isClearPending?: boolean;
  pendingTodos: ThreadTimelinePendingTodos | null;
  /** Changed files, pull request, related / child threads, archive state. */
  context: ThreadContextChipsProps;
  /** Children blocked on input (their latest interaction, for the sheet). */
  childPendingInteractions: readonly ChildThreadPendingAttention[];
  modelFallback: ThreadTimelineModelFallback | null;
  testID?: string;
}

/** Does the chip row have anything to show for these inputs? */
export function hasThreadPromptChips({
  workflows,
  backgroundCommands,
  activePromptMode,
  goal,
  pendingTodos,
  context,
  childPendingInteractions,
  modelFallback,
}: Pick<
  ThreadPromptChipsProps,
  | "workflows"
  | "backgroundCommands"
  | "activePromptMode"
  | "goal"
  | "pendingTodos"
  | "context"
  | "childPendingInteractions"
  | "modelFallback"
>): boolean {
  return (
    workflows.some((workflow) => workflow.status === "pending") ||
    backgroundCommands.length > 0 ||
    activePromptMode?.mode === "plan" ||
    goal?.status === "active" ||
    (pendingTodos?.items.length ?? 0) > 0 ||
    hasThreadContextChips(context.layout, childPendingInteractions) ||
    modelFallback !== null
  );
}

/**
 * The chip row above the composer. Order: frozen state first (archived /
 * environment gone), then children that need input, live activity,
 * changed files and the pull request, the mode chips, to-dos, a model
 * fallback, and last the related-thread link.
 */
export function ThreadPromptChips({
  workflows,
  backgroundCommands,
  activePromptMode,
  onExitPlanMode,
  isExitPending,
  goal,
  onClearGoal,
  isClearPending,
  pendingTodos,
  context,
  childPendingInteractions,
  modelFallback,
  testID = "thread-prompt-chips",
}: ThreadPromptChipsProps) {
  if (
    !hasThreadPromptChips({
      workflows,
      backgroundCommands,
      activePromptMode,
      goal,
      pendingTodos,
      context,
      childPendingInteractions,
      modelFallback,
    })
  ) {
    return null;
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      // Bleed to the screen edge so a half-visible chip hints at the scroll.
      className="-mx-3"
      contentContainerStyle={{ gap: 6, paddingHorizontal: 12 }}
      testID={testID}
    >
      <ThreadStatusChip layout={context.layout} unarchive={context.unarchive} />
      <ThreadChildThreadsChip
        layout={context.layout}
        childPendingInteractions={childPendingInteractions}
        onOpenThread={context.onOpenThread}
      />
      <ThreadWorkflowsChip workflows={workflows} />
      <ThreadBackgroundCommandsChip commands={backgroundCommands} />
      <ThreadChangesChip
        layout={context.layout}
        onPressFile={context.onPressFile}
        onOpenDiff={context.onOpenDiff}
        mergeBase={context.mergeBase}
      />
      <ThreadPullRequestChip
        layout={context.layout}
        onOpenPullRequest={context.onOpenPullRequest}
        pullRequestActions={context.pullRequestActions}
      />
      <ThreadPromptModeChip
        activePromptMode={activePromptMode}
        onExitPlanMode={onExitPlanMode}
        isExitPending={isExitPending}
      />
      <ThreadGoalChip
        goal={goal}
        onClearGoal={onClearGoal}
        isClearPending={isClearPending}
      />
      <ThreadTodoChip pendingTodos={pendingTodos} />
      <ThreadModelFallbackChip fallback={modelFallback} />
      <ThreadRelatedThreadChip
        layout={context.layout}
        onOpenThread={context.onOpenThread}
      />
    </ScrollView>
  );
}

/**
 * Web ThreadModelFallbackCard: the provider switched models mid-thread.
 * Dismissal is per occurrence (`sourceSeq`); a new fallback shows again.
 */
export function ThreadModelFallbackChip({
  fallback,
}: {
  fallback: ThreadTimelineModelFallback | null;
}) {
  const { tokens } = useTheme();
  const [dismissedSourceSeq, setDismissedSourceSeq] = useState<number | null>(
    null,
  );
  if (!fallback || dismissedSourceSeq === fallback.sourceSeq) return null;
  return (
    <PromptChip
      icon="AlertTriangle"
      iconColor={tokens.warningText}
      label="Fallback"
      action={{
        label: "Dismiss model fallback",
        onPress: () => setDismissedSourceSeq(fallback.sourceSeq),
        pending: false,
        testID: "thread-chip-model-fallback-dismiss",
      }}
      title="Model fallback"
      testID="thread-chip-model-fallback"
    >
      <Text className="text-sm text-foreground/90">
        Switched from {modelFallbackLabel(fallback.originalModel)} to{" "}
        {modelFallbackLabel(fallback.fallbackModel)}.
      </Text>
    </PromptChip>
  );
}

/**
 * Threshold (percent of the window) above which the composer shows the
 * context ring. Below it the readout stays out of the way; the full numbers
 * are in the accessibility label and in the thread menu's workspace info.
 */
const CONTEXT_WINDOW_RING_THRESHOLD_PERCENT = 60;

/**
 * Small ring in the composer footer: appears only when the context window is
 * filling up (≥ CONTEXT_WINDOW_RING_THRESHOLD_PERCENT), tinted by the usage
 * tone. The full "used / window" readout lives in the accessibility label.
 */
export function ThreadContextWindowIndicator({
  usage,
}: {
  usage: ThreadContextWindowUsage | undefined;
}) {
  const { tokens } = useTheme();
  if (!usage) return null;
  const percent = calculateContextWindowUsagePercent(usage);
  if (percent < CONTEXT_WINDOW_RING_THRESHOLD_PERCENT) return null;
  const tone = contextWindowTone(percent);
  const color =
    tone === "destructive"
      ? tokens.destructiveText
      : tone === "warning"
        ? tokens.warningText
        : tokens.mutedForeground;
  const readout = `${formatCompactTokenCount(usage.usedTokens)} / ${formatCompactTokenCount(usage.modelContextWindow)}${usage.estimated ? " est." : ""}`;
  return (
    <View
      className="h-10 items-center justify-center px-1"
      accessible
      accessibilityLabel={`Context window ${percent}% used, ${readout}`}
      testID="thread-context-window"
    >
      <ContextRing percent={percent} color={color} track={tokens.border} />
    </View>
  );
}

const RING_SIZE = 18;
const RING_STROKE = 2.5;

function ContextRing({
  percent,
  color,
  track,
}: {
  percent: number;
  color: string;
  track: string;
}) {
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        stroke={track}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={radius}
        stroke={color}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={circumference * (1 - clamped / 100)}
        strokeLinecap="round"
        rotation={-90}
        origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
      />
    </Svg>
  );
}
