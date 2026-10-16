import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  SidebarContent,
  useCloseMobileSidebar,
  useIsSidebarFramed,
} from "@/components/ui/sidebar.js";
import {
  SidebarResizeHandle,
  SidebarTopReserveRow,
} from "@/components/sidebar/SidebarChrome";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { SIDEBAR_STANDARD_ROW_PADDING_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";

export function SectionSidebarIcon({ name }: { name: IconName }) {
  return <Icon name={name} className={COARSE_POINTER_ICON_SIZE_CLASS} />;
}

export function SectionSidebarRow({
  active,
  children,
  label,
  to,
}: {
  active: boolean;
  children?: ReactNode;
  label: string;
  to: string;
}) {
  const closeOnMobile = useCloseMobileSidebar();
  return (
    <Button
      asChild
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      <Link
        to={to}
        onClick={closeOnMobile}
        aria-current={active ? "page" : undefined}
      >
        {children}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </Link>
    </Button>
  );
}

export function SectionSidebarActionRow({
  children,
  label,
  onClick,
  testId,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  const closeOnMobile = useCloseMobileSidebar();
  return (
    <Button
      size="sm"
      variant="ghost"
      data-testid={testId}
      className={cn(PROJECT_LIST_ACTION_BUTTON_CLASS, "w-full")}
      onClick={() => {
        closeOnMobile();
        onClick();
      }}
    >
      {children}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
    </Button>
  );
}

export function SectionSidebarLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        CHROME_SECTION_LABEL_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
      )}
    >
      {children}
    </div>
  );
}

export function SectionSidebar({
  children,
  headerSlot,
  isResizing,
  onResizeMouseDown,
  testIdPrefix,
}: {
  children: ReactNode;
  headerSlot?: ReactNode;
  isResizing: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  testIdPrefix: string;
}) {
  const isFramed = useIsSidebarFramed();
  return (
    <div
      data-testid={`${testIdPrefix}-sidebar-body`}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <SidebarTopReserveRow
        testId={`${testIdPrefix}-sidebar-top-reserve-row`}
        headerSlot={
          headerSlot === undefined ? undefined : (
            <div
              data-sidebar-header-slot=""
              className="flex h-full min-w-0 flex-1 items-center"
            >
              {headerSlot}
            </div>
          )
        }
      />
      <SidebarContent>
        <div
          className={cn(
            "min-w-0 px-2 pb-2.5 max-md:pointer-coarse:pb-1.5",
            isFramed &&
              "pb-[max(0px,calc(var(--bb-macos-traffic-light-center-y)_-_var(--bb-window-frame-lip)_-_1px_-_var(--bb-sidebar-row-height)/2))]",
          )}
        >
          {children}
        </div>
      </SidebarContent>
      <SidebarResizeHandle
        testId={`${testIdPrefix}-sidebar-resize-handle`}
        isResizing={isResizing}
        onMouseDown={onResizeMouseDown}
      />
    </div>
  );
}
