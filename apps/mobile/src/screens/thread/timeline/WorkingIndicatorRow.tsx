import type { ActiveThinking } from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";
import { buildTimelineRowTitle } from "@bb/thread-view";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { resolveItalicFont, useTheme } from "@/theme";
import { Icon, ShimmerText, Text } from "@/ui";
import { TimelineTitleView } from "./TimelineTitleView";

interface WorkingIndicatorRowProps {
  /** "Working…" / "Thinking…" or an override (host reconnecting). */
  label: string;
  /** Streamed reasoning text; tap the row to read it. */
  activeThinking: ActiveThinking | null;
  /** Running provider workflows, listed under the indicator. */
  activeWorkflows: readonly TimelineWorkflowWorkRow[];
}

const THINKING_MAX_LINES = 12;

/**
 * The trailing "Working…" row shown while the thread runtime is busy (web
 * TimelineWorkingIndicator). With thinking text it becomes a disclosure; the
 * active workflows render their own titles underneath.
 */
export function WorkingIndicatorRow({
  label,
  activeThinking,
  activeWorkflows,
}: WorkingIndicatorRowProps) {
  const { tokens } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const details = activeThinking?.text.trim() ?? "";
  const hasDetails = details.length > 0;
  const workflowTitles = useMemo(
    () =>
      activeWorkflows.map((workflow) => ({
        id: workflow.id,
        title: buildTimelineRowTitle(workflow, {
          summaryStyle: "background",
          workStyle: "default",
        }),
      })),
    [activeWorkflows],
  );
  return (
    <View className="px-4 pt-3" testID="timeline-working-indicator">
      <Pressable
        accessibilityRole={hasDetails ? "button" : undefined}
        accessibilityState={hasDetails ? { expanded } : undefined}
        disabled={!hasDetails}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-7 flex-row items-center gap-2"
      >
        <ShimmerText className="text-sm text-muted-foreground">
          {label}
        </ShimmerText>
        {hasDetails ? (
          <Icon
            name={expanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={tokens.mutedForeground}
          />
        ) : null}
      </Pressable>
      {hasDetails && expanded ? (
        <Text
          className="pb-1 text-sm text-muted-foreground"
          // Inter's italic face is its own registered family; `italic` alone
          // would ask iOS to slant a non-italic custom font, which it skips.
          style={resolveItalicFont("regular")}
          numberOfLines={THINKING_MAX_LINES}
          testID="timeline-working-thinking"
        >
          {details}
        </Text>
      ) : null}
      {workflowTitles.map(({ id, title }) => (
        <TimelineTitleView key={id} title={title} style={{ paddingTop: 4 }} />
      ))}
    </View>
  );
}
