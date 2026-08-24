import type { ThreadEventPlanStep } from "@bb/domain";
import type { TimelineRowPresentation } from "@bb/server-contract";
import { workRowPresentation } from "@bb/thread-view";
import { View } from "react-native";
import { Markdown } from "@/markdown";
import { useTheme } from "@/theme";
import { Icon, Text, type IconName } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import { PAST_ROW_DIM_OPACITY } from "../shared/row-dim";
import { WorkRowShell } from "./WorkRowShell";

/**
 * The declarative base for a row's body: the bridge's short Markdown
 * `detail` (docs/provider-plugin-api.md §3), rendered read-only. Mobile loads
 * no plugin JS, so this is every extension row's body and the lead-in of a
 * presented tool/workflow body.
 */
export function PresentationDetail({
  presentation,
}: {
  presentation: TimelineRowPresentation | undefined;
}) {
  const detail = presentation?.detail;
  if (detail === undefined || detail.trim().length === 0) {
    return null;
  }
  return (
    <View testID="timeline-presentation-detail">
      <Markdown
        content={detail}
        selectable={false}
        resolveImageSource={noPresentationImageSource}
      />
    </View>
  );
}

/**
 * A presentation's `detail` is agent-authored Markdown: an image in it
 * renders as its alt text on every surface (docs/provider-plugin-api.md §3),
 * as on the web row body, never as a fetch the user did not decide on.
 */
const noPresentationImageSource = () => null;

/**
 * `work:file-read`, `work:search`, `work:web-search`: title-only rows (the
 * title segments carry the path, the query, or the verb plus queries; the
 * provider reports no body for them on the timeline).
 */
export function TitleOnlyWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<
  "work:file-read" | "work:search" | "work:web-search"
>) {
  return (
    <WorkRowShell
      item={item}
      expandable={false}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}

type PlanStepStatus = NonNullable<ThreadEventPlanStep["status"]>;

const PLAN_STEP_ICON: Record<PlanStepStatus, IconName> = {
  pending: "Square",
  active: "Square",
  completed: "Check",
  failed: "X",
};

/**
 * `work:plan-steps`: the snapshot's steps in the agent's order with a status
 * glyph each (the todo banner re-sorts; the row is the historical record).
 */
export function PlanStepsWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:plan-steps">) {
  const { tokens } = useTheme();
  const row = item.row;
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <View className="gap-1.5" testID="timeline-plan-steps-body">
        <PresentationDetail presentation={workRowPresentation(row)} />
        {row.explanation ? (
          <Text variant="caption">{row.explanation}</Text>
        ) : null}
        {row.steps.map((step, index) => {
          const status = step.status ?? "pending";
          const settled = status === "completed" || status === "failed";
          return (
            <View
              key={`${index}:${step.step}`}
              className="flex-row items-center gap-2"
              style={settled ? { opacity: PAST_ROW_DIM_OPACITY } : undefined}
              testID={`timeline-plan-step-${status}`}
            >
              <Icon
                name={PLAN_STEP_ICON[status]}
                size={14}
                color={
                  status === "active"
                    ? tokens.foreground
                    : tokens.mutedForeground
                }
              />
              <Text
                variant={status === "active" ? "label" : "body"}
                numberOfLines={1}
                className="min-w-0 flex-1"
              >
                {step.step}
              </Text>
            </View>
          );
        })}
      </View>
    </WorkRowShell>
  );
}

/**
 * `work:extension`: a plugin-defined item rendered from its declarative base
 * alone — label, glyph and tint in the header, the detail as the body. No
 * plugin code runs on mobile, by design.
 */
export function ExtensionWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:extension">) {
  return (
    <WorkRowShell
      item={item}
      expandable={item.expandable}
      expanded={expanded}
      onToggle={onToggle}
    >
      <PresentationDetail presentation={item.row.presentation} />
    </WorkRowShell>
  );
}
