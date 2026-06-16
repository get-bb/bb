import { Icon, type IconName } from "@/components/ui/icon.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { cn } from "@/lib/utils";

export type SidebarChildToggleHandler = () => void;

export interface SidebarChildToggleChevronProps {
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  expandTitle: string;
  collapseTitle: string;
  onToggle: SidebarChildToggleHandler;
  /**
   * Optional leading glyph rendered after the caret inside the SAME toggle
   * button, so a disclosure header's caret + icon (e.g. a worktree folder) form
   * one clickable cluster. The label beside the cluster stays inert.
   */
  icon?: IconName;
}

export function SidebarChildToggleChevron({
  isCollapsed,
  expandLabel,
  collapseLabel,
  expandTitle,
  collapseTitle,
  onToggle,
  icon,
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
        "pointer-events-auto relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover hover:text-foreground focus-visible:ring-2",
        icon ? "h-5 gap-0.5 px-1" : "size-5",
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
      {icon ? (
        <Icon
          name={icon}
          className={COARSE_POINTER_ICON_SIZE_CLASS}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
