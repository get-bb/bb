import { useState, type ReactNode } from "react";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  CHROME_ROW_CLASS,
  CHROME_ROW_HEIGHT_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_AXIS_CLASS,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * Shared sizing for icon-only header action buttons (sidebar trigger, kebab
 * menu, secondary-panel toggle, etc.). Keeps button dimensions and SVG sizing
 * consistent across coarse touch and desktop contexts.
 */
export const HEADER_ICON_BUTTON_CLASS = COARSE_POINTER_HEADER_ICON_BUTTON_CLASS;

/**
 * Header icon button whose glyph is painted one optical step smaller than
 * {@link HEADER_ICON_BUTTON_CLASS} while keeping the same button box (and hit
 * target). Used for glyphs that otherwise read oversized next to the compact
 * close/panel controls — currently the pane maximize/restore double-arrows.
 */
export const HEADER_MAXIMIZE_ICON_BUTTON_CLASS =
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS;

interface AppPageHeaderProps {
  center?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
  className?: string;
  /**
   * Whether this header occupies the native title-bar row and may drag the
   * desktop window. Split panes below the workspace's top edge disable this.
   */
  isWindowDragRegion?: boolean;
  /**
   * Whether this header owns the window's top-left chrome footprint. A split
   * may have several top-row drag regions, but only its structural top-left
   * leaf may clear the pinned sidebar trigger and macOS traffic lights.
   */
  ownsWindowTopLeft?: boolean;
}

export function AppPageHeader({
  center,
  actions,
  bordered = true,
  className,
  isWindowDragRegion = true,
  ownsWindowTopLeft = true,
}: AppPageHeaderProps) {
  const isSidebarShowing = useIsSidebarShowing();
  const isCompactViewport = useIsCompactViewport();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });
  const shouldReserveSidebarTrigger =
    ownsWindowTopLeft && (isCompactViewport || !isSidebarShowing);
  return (
    <header
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        "relative shrink-0 bg-surface-scrim px-4 backdrop-blur-sm",
        usesDesktopChrome && isWindowDragRegion && MACOS_WINDOW_DRAG_CLASS,
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
          // In macOS desktop chrome, keep header content on the shared native
          // traffic-light axis so the title bar lines up with the lights, the
          // pinned collapse trigger, and the sidebar arrows. No-op in the web
          // build (no traffic lights).
          usesDesktopChrome && MACOS_CHROME_CONTROL_AXIS_CLASS,
          // The sidebar toggle is pinned at the app's top-left (see AppLayout's
          // SidebarTriggerOverlay). Reserve the fixed button's footprint when
          // the sidebar is collapsed and content shares that row with it; macOS
          // traffic lights add extra left space only while they are visible. On
          // compact viewports, the sidebar opens as an overlay that covers the
          // header, so keep the reserve stable across open/closed drawer state
          // instead of shifting content behind the overlay.
          "transition-[padding] duration-200 ease-linear",
          shouldReserveSidebarTrigger &&
            (reserveMacosTrafficLights
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
