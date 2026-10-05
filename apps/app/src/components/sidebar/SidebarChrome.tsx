import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";

const BROWSER_HEADER_SLOT_START_CLASS =
  "pl-[calc(env(safe-area-inset-left)_+_12px_+_var(--bb-sidebar-control-size)_-_4px)]";
const MACOS_TRAFFIC_LIGHT_HEADER_SLOT_START_CLASS =
  "pl-[calc(84px_+_var(--bb-sidebar-control-size)_-_4px)]";

export const NAV_RAIL_WIDTH_CLASS =
  "w-[calc(var(--bb-sidebar-control-size)_+_24px)]";
const NAV_RAIL_BROWSER_HEADER_SLOT_START_CLASS = "pl-0";
const NAV_RAIL_MACOS_TRAFFIC_LIGHT_HEADER_SLOT_START_CLASS =
  "pl-[calc(84px_-_4px_-_24px)]";

export function SidebarTopReserveRow({
  testId,
  renderHeaderSlot,
  besideNavRail = false,
}: {
  testId: string;
  renderHeaderSlot?: (startInsetClassName: string) => ReactNode;
  besideNavRail?: boolean;
}) {
  const closeOnMobile = useCloseMobileSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });

  return (
    <div
      data-testid={testId}
      className={cn(
        CHROME_ROW_CLASS,
        "shrink-0 justify-end gap-1 px-2",
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
      )}
    >
      {renderHeaderSlot?.(
        besideNavRail
          ? reserveMacosTrafficLights
            ? NAV_RAIL_MACOS_TRAFFIC_LIGHT_HEADER_SLOT_START_CLASS
            : NAV_RAIL_BROWSER_HEADER_SLOT_START_CLASS
          : reserveMacosTrafficLights
            ? MACOS_TRAFFIC_LIGHT_HEADER_SLOT_START_CLASS
            : BROWSER_HEADER_SLOT_START_CLASS,
      )}
      <SidebarHistoryNavigationControls
        onNavigate={closeOnMobile}
        className={cn(
          "shrink-0",
          usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
        )}
      />
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
