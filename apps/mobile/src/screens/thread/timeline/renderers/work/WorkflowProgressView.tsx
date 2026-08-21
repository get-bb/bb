import type {
  WorkflowAgentSnapshot,
  WorkflowProgressSnapshot,
} from "@bb/domain";
import { memo } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { cn, Icon, Spinner, Text } from "@/ui";
import {
  activeWorkflowPhaseKey,
  buildWorkflowAgentStats,
  deriveWorkflowAgentDisplayState,
  groupWorkflowAgentsByPhase,
  isWorkflowPhaseCompleted,
  workflowPhaseGroupKey,
  workflowPhaseProgressLabel,
  workflowPhaseStripState,
  type WorkflowAgentDisplayState,
  type WorkflowPhaseGroup,
  type WorkflowPhaseStripState,
} from "./work-row-model";

/**
 * Native port of the shared-ui `WorkflowProgress` (static phase groups) and
 * `WorkflowPhaseStrip`: phase title + `settled/total` + completed check,
 * then one line per agent with its state glyph, label, error, meta and
 * duration.
 */

function AgentStateGlyph({ state }: { state: WorkflowAgentDisplayState }) {
  const { tokens } = useTheme();
  const size = 14;
  switch (state) {
    case "running":
      return <Spinner size="small" color={tokens.foreground} />;
    case "done":
      return <Icon name="Check" size={size} color={tokens.mutedForeground} />;
    case "failed":
      return <Icon name="X" size={size} color={tokens.destructiveText} />;
    case "skipped":
      return <Icon name="X" size={size} color={tokens.subtleForeground} />;
    case "queued":
    case "interrupted":
      return <Icon name="Circle" size={size} color={tokens.subtleForeground} />;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function WorkflowAgentLine({
  agent,
  workflowSettled,
}: {
  agent: WorkflowAgentSnapshot;
  workflowSettled: boolean;
}) {
  const displayState = deriveWorkflowAgentDisplayState(agent, workflowSettled);
  const stats = buildWorkflowAgentStats(agent, displayState);
  // Phone width: label (and error) on the first line, the meta stats on a
  // second line under it, duration pinned right — the web's single-line
  // layout squeezes the label out at this width.
  return (
    <View
      className="min-h-7 flex-row items-start gap-2 py-0.5"
      testID="timeline-workflow-agent"
    >
      <View className="h-5 w-4 items-center justify-center">
        <AgentStateGlyph state={displayState} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className={cn(
            "text-xs",
            displayState === "running"
              ? "text-foreground"
              : "text-muted-foreground",
          )}
          numberOfLines={1}
        >
          {agent.label}
        </Text>
        {displayState === "failed" && agent.error ? (
          <Text className="text-xs text-destructive-text" numberOfLines={2}>
            {agent.error}
          </Text>
        ) : null}
        {stats.meta.length > 0 ? (
          <Text variant="chrome" mono tone="subtle" numberOfLines={1}>
            {stats.meta}
          </Text>
        ) : null}
      </View>
      {stats.duration !== null ? (
        <Text
          className="min-w-9 text-right text-xs text-subtle-foreground"
          numberOfLines={1}
        >
          {stats.duration}
        </Text>
      ) : null}
    </View>
  );
}

function PhaseGroup({
  group,
  workflowSettled,
}: {
  group: WorkflowPhaseGroup;
  workflowSettled: boolean;
}) {
  const { tokens } = useTheme();
  const lines = group.agents.map((agent) => (
    <WorkflowAgentLine
      key={agent.index}
      agent={agent}
      workflowSettled={workflowSettled}
    />
  ));
  if (!group.phase) return <View>{lines}</View>;
  const completed = isWorkflowPhaseCompleted(group);
  return (
    <View testID="timeline-workflow-phase">
      <View className="flex-row items-center gap-2 py-0.5">
        <Text
          className={cn(
            "text-xs font-medium",
            completed ? "text-subtle-foreground" : "text-foreground",
          )}
          numberOfLines={1}
          style={{ flexShrink: 1 }}
        >
          {group.phase.title}
        </Text>
        <Text className="text-xs text-subtle-foreground">
          {workflowPhaseProgressLabel(group.agents)}
        </Text>
        {completed ? (
          <View className="ml-auto">
            <Icon name="CircleCheck" size={14} color={tokens.success} />
          </View>
        ) : null}
      </View>
      {lines}
    </View>
  );
}

interface WorkflowProgressViewProps {
  progress: WorkflowProgressSnapshot;
  settled: boolean;
  error: string | null;
  testID?: string;
}

export const WorkflowProgressView = memo(function WorkflowProgressView({
  progress,
  settled,
  error,
  testID,
}: WorkflowProgressViewProps) {
  const groups = groupWorkflowAgentsByPhase(progress);
  return (
    <View className="gap-1 py-1" testID={testID}>
      {groups.map((group) => (
        <PhaseGroup
          key={workflowPhaseGroupKey(group)}
          group={group}
          workflowSettled={settled}
        />
      ))}
      {error ? (
        <Text className="py-0.5 text-xs text-destructive-text">{error}</Text>
      ) : null}
    </View>
  );
});

const STRIP_COLOR_KEY: Record<
  WorkflowPhaseStripState,
  "success" | "foreground" | "destructiveText" | "border"
> = {
  done: "success",
  active: "foreground",
  failed: "destructiveText",
  upcoming: "border",
};

/**
 * Segmented per-phase progress strip (web `WorkflowPhaseStrip`): one segment
 * per phase — done, active, failed, upcoming — so a collapsed row still
 * tells the whole story at a glance. Null without phases.
 */
export function WorkflowPhaseStrip({
  progress,
  settled,
}: {
  progress: WorkflowProgressSnapshot;
  settled: boolean;
}) {
  const { tokens } = useTheme();
  const groups = groupWorkflowAgentsByPhase(progress).filter(
    (group) => group.phase !== null,
  );
  if (groups.length === 0) return null;
  const currentKey = activeWorkflowPhaseKey(groups);
  return (
    <View
      className="flex-row gap-1"
      accessibilityElementsHidden
      testID="timeline-workflow-strip"
    >
      {groups.map((group) => {
        const state = workflowPhaseStripState(
          group,
          workflowPhaseGroupKey(group) === currentKey,
          settled,
        );
        return (
          <View
            key={workflowPhaseGroupKey(group)}
            className="h-[3px] flex-1 rounded-full"
            style={{
              minWidth: 4,
              backgroundColor: tokens[STRIP_COLOR_KEY[state]],
              opacity: state === "done" ? 0.6 : state === "failed" ? 0.7 : 1,
            }}
          />
        );
      })}
    </View>
  );
}
