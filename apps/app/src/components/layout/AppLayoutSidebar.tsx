import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AppNavRail } from "@/components/sidebar/AppNavRail";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ResourceSidebar } from "@/components/tools/ResourceSidebar";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useMobileRecentsThreadReveal } from "@/views/useMobileRecentsThreadReveal";

export type AppLayoutSidebarMode = "app" | "settings" | "plugins" | "skills";

interface AppLayoutSidebarProps {
  mode: AppLayoutSidebarMode;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  settingsRoutePath: string;
}

export function AppLayoutSidebar({
  mode,
  onResizeMouseDown,
  isResizing,
  settingsRoutePath,
}: AppLayoutSidebarProps) {
  useMobileRecentsThreadReveal();
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentMode = isCompactViewport && isMobileSidebarClosing;
  const [lastVisibleMode, setLastVisibleMode] = useState(mode);
  if (!holdCurrentMode && lastVisibleMode !== mode) {
    setLastVisibleMode(mode);
  }
  const renderedMode = holdCurrentMode ? lastVisibleMode : mode;

  return (
    <AppSidebar
      onResizeMouseDown={onResizeMouseDown}
      isResizing={isResizing}
      isBodyHidden={renderedMode !== "app"}
      renderRail={(customize) => (
        <AppNavRail
          isAppMode={mode === "app"}
          isSettingsActive={mode === "settings"}
          settingsRoutePath={settingsRoutePath}
          customize={customize}
        />
      )}
      alternateBody={
        renderedMode === "settings" ? (
          <SettingsSidebar
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
          />
        ) : renderedMode === "plugins" || renderedMode === "skills" ? (
          <ResourceSidebar
            key={renderedMode}
            workspace={renderedMode}
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
          />
        ) : null
      }
    />
  );
}
