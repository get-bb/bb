import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ToolsSidebar } from "@/components/tools/ToolsSidebar";
import { Sidebar, useSidebar } from "@/components/ui/sidebar.js";

export type AppLayoutSidebarMode = "app" | "settings" | "tools";

interface AppLayoutSidebarProps {
  mode: AppLayoutSidebarMode;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  appRoutePath: string;
  settingsRoutePath: string;
  toolsBackRoutePath: string;
  toolsRoutePath?: string;
}

/**
 * Picks the sidebar for the current route mode.
 *
 * On wide viewports Settings/Tools replace the entire sidebar. On compact
 * viewports one persistent drawer panel is rendered here and the app sidebar
 * body stays mounted (hidden) behind a Settings/Tools body: mounting the
 * thread list costs hundreds of milliseconds of style/layout on a phone, and
 * every trip through Settings used to pay it again on the way back, in the
 * same task as the destination page render.
 *
 * Mobile closes are intentionally deferred so the compositor can finish the
 * slide before the expensive React state commit; the visible body is held
 * during that window so the close does not swap content mid-slide.
 */
export function AppLayoutSidebar({
  mode,
  onResizeMouseDown,
  isResizing,
  appRoutePath,
  settingsRoutePath,
  toolsBackRoutePath,
  toolsRoutePath,
}: AppLayoutSidebarProps) {
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentMode = isCompactViewport && isMobileSidebarClosing;
  const [lastVisibleMode, setLastVisibleMode] = useState(mode);
  if (!holdCurrentMode && lastVisibleMode !== mode) {
    // React restarts this render before committing, so the next deferred close
    // can retain the current mode without an effect and its follow-up commit.
    setLastVisibleMode(mode);
  }
  const renderedMode = holdCurrentMode ? lastVisibleMode : mode;

  if (isCompactViewport) {
    return (
      <Sidebar>
        <AppSidebar
          onResizeMouseDown={onResizeMouseDown}
          isResizing={isResizing}
          showTopReserve={true}
          settingsRoutePath={settingsRoutePath}
          toolsRoutePath={toolsRoutePath}
          mobileHosted={{ hidden: renderedMode !== "app" }}
        />
        {renderedMode === "settings" ? (
          <SettingsSidebar
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
            showTopReserve={true}
            appRoutePath={appRoutePath}
            mobileHosted
          />
        ) : null}
        {renderedMode === "tools" ? (
          <ToolsSidebar
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
            showTopReserve={true}
            appRoutePath={toolsBackRoutePath}
            mobileHosted
          />
        ) : null}
      </Sidebar>
    );
  }

  if (renderedMode === "settings") {
    return (
      <SettingsSidebar
        onResizeMouseDown={onResizeMouseDown}
        isResizing={isResizing}
        showTopReserve={true}
        appRoutePath={appRoutePath}
      />
    );
  }

  if (renderedMode === "tools") {
    return (
      <ToolsSidebar
        onResizeMouseDown={onResizeMouseDown}
        isResizing={isResizing}
        showTopReserve={true}
        appRoutePath={toolsBackRoutePath}
      />
    );
  }

  return (
    <AppSidebar
      onResizeMouseDown={onResizeMouseDown}
      isResizing={isResizing}
      showTopReserve={true}
      settingsRoutePath={settingsRoutePath}
      toolsRoutePath={toolsRoutePath}
    />
  );
}
