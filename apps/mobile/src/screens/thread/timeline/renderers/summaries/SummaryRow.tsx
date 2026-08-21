import type { TimelineRowRendererProps } from "../../renderers";
import {
  ExpandableRowHeader,
  TimelineRowShell,
} from "../shared/ExpandableRowHeader";
import { isPastTimelineRow } from "../shared/row-dim";

/**
 * `step-summary` / `bundle-summary` renderer: the rolled-up header of a run
 * of work rows ("Explored 4 files, ran 2 commands"; the verb shimmers while
 * the bundle is the live frontier). The title — verb/rest split, duration,
 * error counts, diff stats — is built by `@bb/thread-view`; expanding
 * reveals the grouped work rows as flattened children one level in.
 */
export function SummaryRow({
  item,
  expanded,
  onToggle,
}: TimelineRowRendererProps<"step-summary" | "bundle-summary">) {
  return (
    <TimelineRowShell depth={item.depth} kind={item.kind}>
      <ExpandableRowHeader
        title={item.title}
        expandable={item.expandable}
        expanded={item.expandable && expanded}
        onToggle={onToggle}
        dimmed={isPastTimelineRow(item)}
        testID={`timeline-${item.kind}-header`}
      />
    </TimelineRowShell>
  );
}
