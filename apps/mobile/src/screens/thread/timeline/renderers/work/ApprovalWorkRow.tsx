import { useTheme } from "@/theme";
import { Icon } from "@/ui";
import type { TimelineRowRendererProps } from "../../renderers";
import { describeApprovalDecision } from "./work-row-model";
import { WorkRowShell } from "./WorkRowShell";

/**
 * `work:approval` (file-edit / permission-grant): read-only. The title spells
 * out the lifecycle and grant scope ("Permission granted for this session:
 * Edit"); a trailing glyph lands the decision in a fixed spot. Acting on a
 * pending approval is the Phase 4b banner's job.
 */
export function ApprovalWorkRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"work:approval">) {
  const { tokens } = useTheme();
  const decision = describeApprovalDecision(item.row);
  const color =
    decision.tone === "granted"
      ? tokens.success
      : decision.tone === "denied"
        ? tokens.destructiveText
        : tokens.mutedForeground;
  return (
    <WorkRowShell
      item={item}
      expandable={false}
      expanded={expanded}
      onToggle={onToggle}
      trailing={
        <Icon
          name={decision.icon}
          size={14}
          color={color}
          accessibilityLabel={decision.label}
        />
      }
    />
  );
}
