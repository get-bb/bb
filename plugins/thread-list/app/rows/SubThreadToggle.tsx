import { useId, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { LIST_HOVER_TRANSITION } from "@/components/ui/motion";
import {
  SIDEBAR_CONTROL_STATE_CLASS,
  getSidebarThreadGroupLineLeft,
  getSidebarThreadRowPaddingLeft,
} from "@/components/ui/sidebar-row-classes";
import { cn } from "@/lib/utils";

const DISCLOSURE_SIZE_PX = 16;
const DISCLOSURE_CLEARANCE_PX = 2;
const DISCLOSURE_ROW_PADDING_OVERLAP_PX =
  getSidebarThreadRowPaddingLeft(0) - DISCLOSURE_CLEARANCE_PX;

const DISCLOSURE_SLOT_STYLE = {
  width: DISCLOSURE_SIZE_PX,
  height: DISCLOSURE_SIZE_PX,
  marginLeft: -DISCLOSURE_ROW_PADDING_OVERLAP_PX,
  marginRight: DISCLOSURE_CLEARANCE_PX,
} satisfies CSSProperties;

interface SubThreadToggleProps {
  count: number;
  working: number;
  isCollapsed: boolean;
  expandLabel: string;
  collapseLabel: string;
  slot: "provider-icon" | "disclosure";
  icon: ReactNode;
  iconLabel: string | null;
  onToggle: () => void;
}

export function getSubThreadGuideLeft(
  parentDepth: number,
  showProviderIcons: boolean,
): number {
  return showProviderIcons
    ? getSidebarThreadGroupLineLeft(parentDepth)
    : getSidebarThreadRowPaddingLeft(parentDepth) -
        DISCLOSURE_ROW_PADDING_OVERLAP_PX +
        DISCLOSURE_SIZE_PX / 2;
}

export function SubThreadDisclosureSlot() {
  return (
    <span
      aria-hidden="true"
      data-sidebar-sub-thread-slot=""
      className="shrink-0"
      style={DISCLOSURE_SLOT_STYLE}
    />
  );
}

function formatSubThreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function describeSubThreads(
  count: number,
  working: number,
  iconLabel: string | null,
): string {
  return [
    `${count} ${count === 1 ? "thread" : "threads"}`,
    working > 0 ? `${working} working` : null,
    iconLabel,
  ]
    .filter((part) => part !== null)
    .join(", ");
}

export function SubThreadToggle({
  count,
  working,
  isCollapsed,
  expandLabel,
  collapseLabel,
  slot,
  icon,
  iconLabel,
  onToggle,
}: SubThreadToggleProps) {
  const descriptionId = useId();
  const inDisclosureSlot = slot === "disclosure";
  const hasIcon = icon !== null;
  return (
    <button
      type="button"
      data-sidebar-sub-thread-toggle=""
      data-sidebar-rename-anchor=""
      aria-expanded={!isCollapsed}
      aria-label={isCollapsed ? expandLabel : collapseLabel}
      aria-describedby={descriptionId}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      style={inDisclosureSlot ? DISCLOSURE_SLOT_STYLE : undefined}
      className={cn(
        "pointer-events-auto relative z-[31] flex shrink-0 cursor-pointer items-center justify-center rounded-[5px] outline-none ring-sidebar-ring focus-visible:ring-2 focus-visible:ring-inset",
        "after:absolute after:content-['']",
        inDisclosureSlot
          ? "after:-inset-x-0.5 after:-inset-y-1 max-md:pointer-coarse:after:-inset-y-2.5 max-md:pointer-coarse:after:-right-2.5"
          : "-my-0.5 -ml-0.5 mr-1.5 size-5 after:-inset-1 max-md:pointer-coarse:after:-inset-2",
        SIDEBAR_CONTROL_STATE_CLASS,
        LIST_HOVER_TRANSITION,
      )}
    >
      {hasIcon ? (
        <span className="flex items-center justify-center text-muted-foreground group-hover/thread-row:hidden group-has-[:focus-visible]/thread-row:hidden [@media(hover:none)]:hidden">
          {icon}
        </span>
      ) : null}
      <Icon
        name="ChevronRight"
        className={cn(
          inDisclosureSlot ? "size-3" : "size-3.5",
          "transition-transform duration-150",
          !isCollapsed && "rotate-90",
          hasIcon &&
            "hidden group-hover/thread-row:block group-has-[:focus-visible]/thread-row:block [@media(hover:none)]:block",
        )}
        aria-hidden="true"
      />
      <span id={descriptionId} className="sr-only">
        {describeSubThreads(count, working, iconLabel)}
      </span>
    </button>
  );
}

export function SubThreadCount({
  count,
  working,
  glyph,
}: {
  count: number;
  working: number;
  glyph: ReactNode;
}) {
  return (
    <span
      data-sidebar-sub-thread-count=""
      aria-hidden="true"
      className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 text-2xs tabular-nums text-muted-foreground"
    >
      {working > 0 ? (
        <>
          <span className="flex items-center [&_svg]:size-3">{glyph}</span>
          {`${formatSubThreadCount(working)}/${formatSubThreadCount(count)}`}
        </>
      ) : (
        formatSubThreadCount(count)
      )}
    </span>
  );
}
