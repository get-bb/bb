import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import {
  sidebarNavigationPlacement,
  useResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
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
  backToAppRoutePath: string | null;
}

export function AppLayoutSidebar({
  mode,
  onResizeMouseDown,
  isResizing,
  settingsRoutePath,
  backToAppRoutePath,
}: AppLayoutSidebarProps) {
  useMobileRecentsThreadReveal();
  const navigation = useResolvedSidebarNavigation();
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentMode = isCompactViewport && isMobileSidebarClosing;
  const [lastVisible, setLastVisible] = useState({ mode, backToAppRoutePath });
  if (
    !holdCurrentMode &&
    (lastVisible.mode !== mode ||
      lastVisible.backToAppRoutePath !== backToAppRoutePath)
  ) {
    setLastVisible({ mode, backToAppRoutePath });
  }
  const rendered = holdCurrentMode ? lastVisible : { mode, backToAppRoutePath };
  const backTo =
    sidebarNavigationPlacement(navigation) === "list"
      ? rendered.backToAppRoutePath
      : null;

  return (
    <AppSidebar
      onResizeMouseDown={onResizeMouseDown}
      isResizing={isResizing}
      isBodyHidden={rendered.mode !== "app"}
      navigation={navigation}
      settingsRoutePath={settingsRoutePath}
      isSettingsActive={mode === "settings"}
      alternateBody={
        rendered.mode === "settings" ? (
          <SettingsSidebar
            backTo={backTo}
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
          />
        ) : rendered.mode === "plugins" || rendered.mode === "skills" ? (
          <ResourceSidebar
            key={rendered.mode}
            workspace={rendered.mode}
            backTo={backTo}
            onResizeMouseDown={onResizeMouseDown}
            isResizing={isResizing}
          />
        ) : null
      }
    />
  );
}
