import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ToolsSidebar } from "@/components/tools/ToolsSidebar";
import { useSidebar } from "@/components/ui/sidebar.js";

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
 * Keeps the current mobile drawer mounted until its close animation finishes.
 *
 * Routes such as Settings replace the entire sidebar. Mobile closes are
 * intentionally deferred so the compositor can finish the slide before the
 * expensive React state commit. Swapping sidebar modes during that window
 * would mount a fresh, still-open panel and replay the close animation.
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
