import { useState, type ReactNode, type Ref } from "react";
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
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
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
 * Shared geometry for the maximize and close controls at the end of a pane
 * header. Keeping both controls on one class gives their button boxes and
 * glyphs the same center axis.
 */
export const HEADER_PANE_ACTION_ICON_BUTTON_CLASS =
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS;

/**
 * Seam that separates a header row from the body below it. Every app header
 * carries this seam, so it belongs to the shared chrome instead of to each
 * call site. Panes without it read as if their title bar floats on the body.
 */
export const HEADER_SEAM_CLASS = "border-b border-border-seam-vertical/60";

/**
 * Shared page-header surface treatment. Secondary chrome that sits beside a
 * page header can reuse this token so the two regions read as one title row.
 * No `backdrop-blur`: the header is a non-overlapping flex sibling above the
 * scroller, so nothing paints behind it and a blur would only add a
 * compositing pass on every frame.
 */
export const APP_PAGE_HEADER_SURFACE_CLASS = "bg-surface-scrim";

interface AppPageHeaderProps {
  center?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headerRef?: Ref<HTMLElement>;
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
  className,
  headerRef,
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
      ref={headerRef}
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        HEADER_SEAM_CLASS,
        APP_PAGE_HEADER_SURFACE_CLASS,
        "relative shrink-0 select-none px-4",
        usesDesktopChrome && isWindowDragRegion && MACOS_WINDOW_DRAG_CLASS,
        className,
      )}
    >
      <div
        data-testid="app-page-header-content-row"
        className={cn(
          // Center title/actions on the shared chrome axis using the full
          // chrome-row height so native title-bar controls stay aligned.
          CHROME_ROW_CLASS,
          "relative z-10 gap-1 md:gap-2",
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
              ? MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS
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
