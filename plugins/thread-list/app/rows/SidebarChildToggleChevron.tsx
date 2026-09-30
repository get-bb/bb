import { Icon } from "@/components/ui/icon";
import { LIST_HOVER_TRANSITION } from "@/components/ui/motion";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
} from "../ui/sidebar-hover-actions.js";
import { SIDEBAR_CONTROL_STATE_CLASS } from "./sidebarRowClasses.js";

const COARSE_POINTER_CHILD_TOGGLE_HIT_AREA_CLASS =
  "max-md:pointer-coarse:after:absolute max-md:pointer-coarse:after:-inset-y-2 max-md:pointer-coarse:after:-left-1.5 max-md:pointer-coarse:after:-right-2.5 max-md:pointer-coarse:after:content-['']";

interface SidebarChildToggleChevronProps {
  disabled?: boolean;
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  onToggle: () => void;
  revealOnHover?: boolean;
  className?: string;
}

export function SidebarChildToggleChevron({
  disabled = false,
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
      disabled={disabled}
      data-sidebar-rename-anchor=""
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
        COARSE_POINTER_CHILD_TOGGLE_HIT_AREA_CLASS,
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
