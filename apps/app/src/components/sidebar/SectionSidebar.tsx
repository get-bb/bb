import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Sidebar,
  SidebarContent,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar.js";
import {
  SidebarResizeHandle,
  SidebarTopReserveRow,
} from "@/components/sidebar/SidebarChrome";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { SIDEBAR_STANDARD_ROW_PADDING_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import {
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_AXIS_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";

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
  backLabel,
  backTo,
  children,
  isResizing,
  mobileHosted = false,
  navRailTitle,
  onResizeMouseDown,
  testIdPrefix,
}: {
  backLabel: string;
  backTo: string;
  children: ReactNode;
  isResizing: boolean;
  mobileHosted?: boolean;
  navRailTitle?: string;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  testIdPrefix: string;
}) {
  const [desktopInfo] = useState(getBbDesktopInfo);
  const body = (
    <>
      {navRailTitle === undefined ? (
        <>
          <SidebarTopReserveRow
            testId={`${testIdPrefix}-sidebar-top-reserve-row`}
          />
          <div className="shrink-0 px-2 py-2">
            <div className="space-y-1">
              <SectionSidebarRow active={false} label={backLabel} to={backTo}>
                <SectionSidebarIcon name="ChevronLeft" />
              </SectionSidebarRow>
            </div>
          </div>
        </>
      ) : (
        <SidebarTopReserveRow
          testId={`${testIdPrefix}-sidebar-top-reserve-row`}
          besideNavRail
          renderHeaderSlot={(startInsetClassName) => (
            <div
              className={cn(
                "flex h-full min-w-0 flex-1 items-center",
                startInsetClassName,
              )}
            >
              <h2
                className={cn(
                  "min-w-0 truncate pl-2 text-sm font-medium text-sidebar-foreground",
                  shouldUseMacosDesktopChrome(desktopInfo) &&
                    MACOS_CHROME_CONTROL_AXIS_CLASS,
                )}
              >
                {navRailTitle}
              </h2>
            </div>
          )}
        />
      )}
      <SidebarContent>
        <div className="min-w-0 px-2">{children}</div>
      </SidebarContent>
      <SidebarResizeHandle
        testId={`${testIdPrefix}-sidebar-resize-handle`}
        isResizing={isResizing}
        onMouseDown={onResizeMouseDown}
      />
    </>
  );

  if (mobileHosted || navRailTitle !== undefined) {
    return (
      <div
        data-testid={`${testIdPrefix}-sidebar-body`}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        {body}
      </div>
    );
  }

  return <Sidebar>{body}</Sidebar>;
}
