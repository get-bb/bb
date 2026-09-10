import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { PluginsSidebar } from "@/components/plugin/PluginsSidebar";
import { SkillsSidebar } from "@/components/tools/SkillsSidebar";
import { Sidebar, useSidebar } from "@/components/ui/sidebar.js";

export type AppLayoutSidebarMode =
  | "app"
  | "settings"
  | "plugins"
  | "skills";

interface AppLayoutSidebarProps {
  mode: AppLayoutSidebarMode;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  appRoutePath: string;
  settingsRoutePath: string;
  toolsBackRoutePath: string;
  toolsRoutePath?: string;
}

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
        {renderedMode === "plugins" ? (
          <PluginsSidebar
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
            showTopReserve={true}
            appRoutePath={toolsBackRoutePath}
            mobileHosted
          />
        ) : null}
        {renderedMode === "skills" ? (
          <SkillsSidebar
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

  if (renderedMode === "plugins") {
    return (
      <PluginsSidebar
        onResizeMouseDown={onResizeMouseDown}
        isResizing={isResizing}
        showTopReserve={true}
        appRoutePath={toolsBackRoutePath}
      />
    );
  }

  if (renderedMode === "skills") {
    return (
      <SkillsSidebar
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
