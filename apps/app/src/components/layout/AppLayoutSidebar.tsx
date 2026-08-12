import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  const { isCompactViewport, openMobile } = useSidebar();
  const holdCurrentMode = isCompactViewport && openMobile;
  const [settledMode, setSettledMode] = useState(mode);

  useEffect(() => {
    if (!holdCurrentMode) {
      setSettledMode(mode);
    }
  }, [holdCurrentMode, mode]);

  const renderedMode = holdCurrentMode ? settledMode : mode;

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
