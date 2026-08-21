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
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { usePickerSheetMaxHeight } from "@/screens/pickers";
import { useTheme } from "@/theme";
import { cn, Icon, Sheet, Spinner, Text, useSheet, type IconName } from "@/ui";
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
 * (apps/app/src/components/promptbox/banner/*): running workflows,
 * background commands / agents, plan mode (Exit), goal (Clear), to-dos.
 * The web stacks one collapsible card per item above the composer; on a
 * phone five cards push the timeline off the screen, so each item is a
 * chip in one horizontal row instead, and a tap opens a bottom sheet with
 * the detail the web card shows expanded.
 */

interface PromptChipAction {
  label: string;
  onPress: () => void;
  pending: boolean;
  testID?: string;
}

interface PromptChipProps {
  icon: IconName;
  label: string;
  /** Muted segment after the label ("0/4 agents", "3/7"). */
  detail?: string;
  /** Trailing "X" action (exit plan mode / clear goal). */
  action?: PromptChipAction | null;
  /** Pulse a dot in place of the icon (a live activity). */
  live?: boolean;
  /** Sheet title; also names the chip for the screen reader. */
  sheetTitle: string;
  /** Sheet body. */
  children: ReactNode;
  testID?: string;
}

/** Pulsing dot for live activity chips. */
function LiveDot() {
  const { tokens } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.set(
      withRepeat(
        withSequence(
          withTiming(0.35, { duration: 800 }),
          withTiming(1, { duration: 800 }),
        ),
        -1,
      ),
    );
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View
      style={[
        {
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: tokens.success,
        },
        animated,
      ]}
    />
  );
}

function PromptChip({
  icon,
  label,
  detail,
  action,
  live = false,
  sheetTitle,
  children,
  testID,
}: PromptChipProps) {
  const { tokens } = useTheme();
  const sheet = useSheet();
  const maxHeight = usePickerSheetMaxHeight();
  return (
    <>
      <View
        className="h-9 flex-row items-center overflow-hidden rounded-full border border-pill-surface-border bg-surface-raised-solid"
        testID={testID}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${sheetTitle}: ${label}${detail ? ` ${detail}` : ""}`}
          onPress={sheet.present}
          className={cn(
            "h-full flex-row items-center gap-1.5 pl-3",
            action ? "pr-2" : "pr-3",
            "active:bg-state-hover",
          )}
        >
          {live ? (
            <LiveDot />
          ) : (
            <Icon name={icon} size={14} color={tokens.pillIcon} />
          )}
          <Text variant="label" numberOfLines={1} className="max-w-[180px]">
            {label}
          </Text>
          {detail ? (
            <Text variant="caption" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </Pressable>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityState={{ disabled: action.pending }}
            disabled={action.pending}
            onPress={action.onPress}
            className="h-full w-8 items-center justify-center border-l border-pill-surface-border active:bg-state-hover"
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
      <Sheet
        controller={sheet}
        title={sheetTitle}
        layout="scroll"
        maxDynamicContentSize={maxHeight}
      >
        <View
          className="px-4 pb-2 pt-3"
          testID={testID ? `${testID}-sheet` : undefined}
        >
          {children}
        </View>
      </Sheet>
    </>
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
      sheetTitle={single ? "Workflow" : "Workflows"}
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

/** Chip copy: "2 commands", "1 agent", "3 tasks" (the sheet title says "background"). */
function backgroundActivityLabel(
  commands: readonly TimelineWorkflowWorkRow[],
): string {
  const agentCount = commands.filter((row) =>
    isBackgroundAgentTaskType(row.taskType),
  ).length;
  const commandCount = commands.length - agentCount;
  if (commandCount === 0) {
    return `${agentCount} agent${agentCount === 1 ? "" : "s"}`;
  }
  if (agentCount === 0) {
    return `${commandCount} command${commandCount === 1 ? "" : "s"}`;
  }
  return `${commands.length} tasks`;
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
  return (
    <PromptChip
      icon="Terminal"
      live
      label={backgroundActivityLabel(commands)}
      sheetTitle="Background activity"
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
      sheetTitle="Plan mode"
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
      sheetTitle="Goal"
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
      sheetTitle="To-dos"
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
  testID?: string;
}

/** Does the chip row have anything to show for these inputs? */
export function hasThreadPromptChips({
  workflows,
  backgroundCommands,
  activePromptMode,
  goal,
  pendingTodos,
}: Pick<
  ThreadPromptChipsProps,
  | "workflows"
  | "backgroundCommands"
  | "activePromptMode"
  | "goal"
  | "pendingTodos"
>): boolean {
  return (
    workflows.some((workflow) => workflow.status === "pending") ||
    backgroundCommands.length > 0 ||
    activePromptMode?.mode === "plan" ||
    goal?.status === "active" ||
    (pendingTodos?.items.length ?? 0) > 0
  );
}

/**
 * The chip row above the composer: one horizontal, scrollable line no
 * matter how many things run. Renders nothing when no chip applies, so
 * the stack's gap does not open up for an empty row.
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
  testID = "thread-prompt-chips",
}: ThreadPromptChipsProps) {
  if (
    !hasThreadPromptChips({
      workflows,
      backgroundCommands,
      activePromptMode,
      goal,
      pendingTodos,
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
      <ThreadWorkflowsChip workflows={workflows} />
      <ThreadBackgroundCommandsChip commands={backgroundCommands} />
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
    </ScrollView>
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
