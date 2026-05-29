import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface ConversationCollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

/**
 * Round chevron control that lives on the seam between the conversation pane
 * and the secondary panel. It collapses the conversation (so the panel fills
 * the content area) and expands it again, flipping its chevron with state.
 *
 * It must be rendered as a sibling of — not a child of — the resize handle:
 * react-resizable-panels starts a resize from a capture-phase pointerdown on
 * `document.body`, which a React handler here cannot intercept, but the library
 * excludes a higher-stacked sibling that merely overlaps the handle.
 */
export function ConversationCollapseToggle({
  collapsed,
  onToggle,
  className,
}: ConversationCollapseToggleProps) {
  const label = collapsed ? "Show conversation" : "Collapse conversation";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      aria-expanded={!collapsed}
      title={label}
      onClick={onToggle}
      className={cn(
        "size-6 rounded-full border-border bg-card p-0 text-muted-foreground shadow-sm hover:text-foreground",
        className,
      )}
    >
      <Icon
        name={collapsed ? "ChevronRight" : "ChevronLeft"}
        className="size-3.5"
        aria-hidden="true"
      />
    </Button>
  );
}
