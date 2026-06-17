import { Icon } from "@/components/ui/icon.js";
import { SIDEBAR_HOVER_ACTIONS_CLASS } from "@/components/ui/sidebar-hover-actions.js";
import { cn } from "@/lib/utils";

export type SidebarChildToggleHandler = () => void;

export interface SidebarChildToggleChevronProps {
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  expandTitle: string;
  collapseTitle: string;
  onToggle: SidebarChildToggleHandler;
  revealOnHover?: boolean;
}

export function SidebarChildToggleChevron({
  isCollapsed,
  expandLabel,
  collapseLabel,
  expandTitle,
  collapseTitle,
  onToggle,
  revealOnHover = false,
}: SidebarChildToggleChevronProps) {
  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? expandLabel : collapseLabel}
      title={isCollapsed ? expandTitle : collapseTitle}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        revealOnHover ? SIDEBAR_HOVER_ACTIONS_CLASS : "pointer-events-auto",
        "relative z-10 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2",
      )}
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3 transition-transform duration-150",
          !isCollapsed && "rotate-90",
        )}
        aria-hidden="true"
      />
    </button>
  );
}
