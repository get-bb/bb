import { useState, type ReactNode } from "react";
import {
  SidebarTrigger,
  useIsSidebarShowing,
} from "@/components/ui/sidebar.js";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import {
  getBbDesktopInfo,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";

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
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const showSidebarTrigger = !isSidebarShowing;
  return (
    <header
      className={cn(
        "relative h-12 shrink-0 bg-surface-scrim px-4 backdrop-blur-sm",
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        bordered && "border-b border-border",
        className,
      )}
    >
      <div
        data-testid="app-page-header-content-row"
        className={cn(
          "flex h-full items-center gap-1 md:gap-2",
          usesDesktopChrome &&
            !isSidebarShowing &&
            MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
        )}
      >
        {showSidebarTrigger ? (
          usesDesktopChrome ? (
            // The visible toggle is pinned at the window root (see AppLayout's
            // DesktopSidebarTriggerOverlay). Reserve its footprint here so the
            // header content lines up identically whether the sidebar is open
            // or collapsed.
            <div
              aria-hidden
              data-testid="app-page-header-trigger-spacer"
              className={cn("shrink-0", HEADER_ICON_BUTTON_CLASS)}
            />
          ) : (
            <SidebarTrigger className="-ml-2 shrink-0 md:ml-0" />
          )
        ) : null}
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
