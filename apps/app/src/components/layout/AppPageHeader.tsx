import { useState, type ReactNode } from "react";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  CHROME_ROW_CLASS,
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * Shared sizing for icon-only header action buttons (sidebar trigger, kebab
 * menu, secondary-panel toggle, etc.). Keeps button dimensions and SVG sizing
 * consistent across coarse touch and desktop contexts.
 */
export const HEADER_ICON_BUTTON_CLASS = COARSE_POINTER_HEADER_ICON_BUTTON_CLASS;

interface AppPageHeaderProps {
  center?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
  className?: string;
}

export function AppPageHeader({
  center,
  actions,
  bordered = true,
  className,
}: AppPageHeaderProps) {
  const isSidebarShowing = useIsSidebarShowing();
  const isCompactViewport = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const shouldReserveSidebarTrigger =
    isCompactViewport || !isSidebarShowing;
  return (
    <header
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        "relative shrink-0 bg-surface-scrim px-4 backdrop-blur-sm",
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        bordered && "border-b border-border-seam",
        className,
      )}
    >
      <div
        data-testid="app-page-header-content-row"
        className={cn(
          // Center the title/actions on the shared chrome axis using the chrome
          // row's full height rather than `h-full`: a bordered header's `border-b`
          // shrinks the content box by 1px, which would otherwise drift the
          // visual center half a pixel above the traffic-light / sidebar-arrow
          // axis.
          CHROME_ROW_CLASS,
          "gap-1 md:gap-2",
          // In macOS desktop chrome, drop the header content onto the native
          // traffic-light axis (which renders ~2 CSS px below the row center) so
          // the title bar lines up with the lights, the pinned collapse trigger,
          // and the sidebar arrows. No-op in the web build (no traffic lights).
          usesDesktopChrome && MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
          // The sidebar toggle is pinned at the app's top-left (see AppLayout's
          // SidebarTriggerOverlay). On desktop, reserve its footprint only when
          // the sidebar is collapsed and content shares that row with the fixed
          // button. On compact viewports, the sidebar opens as an overlay that
          // covers the header, so keep the reserve stable across open/closed
          // drawer state instead of shifting content behind the overlay.
          "transition-[padding] duration-200 ease-linear",
          shouldReserveSidebarTrigger &&
            (usesDesktopChrome
              ? MACOS_COLLAPSED_HEADER_RESERVE_CLASS
              : BROWSER_COLLAPSED_HEADER_RESERVE_CLASS),
        )}
      >
        {center ? (
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 max-w-full items-center gap-2">
              {center}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
