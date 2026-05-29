import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface SeamPanelArrowProps {
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
  className?: string;
}

/**
 * The single directional arrow that lives on the seam between the conversation
 * and the secondary panel. It unifies what used to be three separate controls
 * (the header "show secondary panel" and "collapse conversation" buttons and a
 * standalone seam chevron) into one space-management affordance whose direction
 * and intent flip with state:
 *
 *   panel closed                   → ◀ opens the secondary panel ("Show panel").
 *                                      The seam sits at the content's right edge
 *                                      in this state, so the arrow surfaces there.
 *   panel open, conversation shown → ◀ collapses the conversation so the panel
 *                                      fills the area ("Expand panel").
 *   conversation collapsed         → ▶ restores the conversation ("Expand
 *                                      conversation"); the 48px rail does the same.
 *
 * It must be rendered as a sibling of — not a child of — the resize handle:
 * react-resizable-panels starts a resize from a capture-phase pointerdown on
 * `document.body`, which a React handler here cannot intercept, but the library
 * excludes a higher-stacked sibling that merely overlaps the handle.
 */
export function SeamPanelArrow({
  isSecondaryPanelOpen,
  isConversationCollapsed,
  onToggleSecondaryPanel,
  onToggleConversationCollapse,
  className,
}: SeamPanelArrowProps) {
  // ▶ only when the conversation is collapsed (give room back to the middle);
  // ◀ in every other state (give room to the panel, or reveal it).
  const pointsRight = isSecondaryPanelOpen && isConversationCollapsed;
  const label = !isSecondaryPanelOpen
    ? "Show panel"
    : isConversationCollapsed
      ? "Expand conversation"
      : "Expand panel";
  // While the panel is open the arrow toggles the conversation; while it is
  // closed the arrow reveals the panel.
  const onClick = isSecondaryPanelOpen
    ? onToggleConversationCollapse
    : onToggleSecondaryPanel;
  // Disclosure state: when closed the arrow discloses the panel (collapsed);
  // once open it discloses the conversation it collapses/expands.
  const isExpanded = isSecondaryPanelOpen ? !isConversationCollapsed : false;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      aria-expanded={isExpanded}
      title={label}
      onClick={onClick}
      className={cn(
        "size-6 rounded-full border-border bg-card p-0 text-muted-foreground shadow-sm hover:text-foreground",
        className,
      )}
    >
      <Icon
        name={pointsRight ? "ChevronRight" : "ChevronLeft"}
        className="size-3.5"
        aria-hidden="true"
      />
    </Button>
  );
}
