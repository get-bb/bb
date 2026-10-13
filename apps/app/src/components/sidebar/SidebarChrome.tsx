import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  useCloseMobileSidebar,
  useIsSidebarFramed,
} from "@/components/ui/sidebar.js";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";

export function SidebarTopReserveRow({
  testId,
  headerSlot,
}: {
  testId: string;
  headerSlot?: ReactNode;
}) {
  const closeOnMobile = useCloseMobileSidebar();
  const isFramed = useIsSidebarFramed();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);

  if (isFramed && headerSlot === undefined) {
    return <div data-testid={testId} className="h-2 shrink-0" />;
  }

  return (
    <div
      data-testid={testId}
      className={cn(
        CHROME_ROW_CLASS,
        "shrink-0 justify-end gap-1 px-2",
        usesDesktopChrome && !isFramed && MACOS_WINDOW_DRAG_CLASS,
      )}
    >
      {headerSlot}
      {isFramed ? null : (
        <SidebarHistoryNavigationControls
          onNavigate={closeOnMobile}
          className={cn(
            "shrink-0",
            usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
          )}
        />
      )}
    </div>
  );
}

export function SidebarResizeHandle({
  isResizing,
  onMouseDown,
  testId,
}: {
  isResizing: boolean;
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
        isResizing && "before:bg-sidebar-border",
      )}
      onMouseDown={onMouseDown}
    />
  );
}
