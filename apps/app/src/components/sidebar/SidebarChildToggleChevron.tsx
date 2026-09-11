import { Icon } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
} from "@/components/ui/sidebar-hover-actions.js";
import { cn } from "@bb/shared-ui/lib/utils";
import { SIDEBAR_CONTROL_STATE_CLASS } from "./sidebarRowClasses";

interface SidebarChildToggleChevronProps {
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onToggle: () => void;
  revealOnHover?: boolean;
  className?: string;
}

export function SidebarChildToggleChevron({
  isCollapsed,
  expandLabel,
  collapseLabel,
  onToggle,
  revealOnHover = false,
  className,
}: SidebarChildToggleChevronProps) {
  return (
    <button
      type="button"
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? expandLabel : collapseLabel}
      data-sidebar-hover-actions-mobile={
        revealOnHover ? SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE : undefined
      }
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        revealOnHover ? SIDEBAR_HOVER_ACTIONS_CLASS : "pointer-events-auto",
        "relative z-10 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none ring-sidebar-ring focus-visible:ring-2",
        SIDEBAR_CONTROL_STATE_CLASS,
        LIST_HOVER_TRANSITION,
        className,
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
