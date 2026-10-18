import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
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
  pluginSidebar?: { panel: PluginNavPanelSlot; subPath: string };
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  settingsRoutePath: string;
  backToAppRoutePath: string | null;
}

export function AppLayoutSidebar({
  mode,
  pluginSidebar,
  onResizeMouseDown,
  isResizing,
  settingsRoutePath,
  backToAppRoutePath,
}: AppLayoutSidebarProps) {
  useMobileRecentsThreadReveal();
  const navigation = useResolvedSidebarNavigation();
  const { isCompactViewport, isMobileSidebarClosing } = useSidebar();
  const holdCurrentMode = isCompactViewport && isMobileSidebarClosing;
  const [lastVisible, setLastVisible] = useState({
    mode,
    backToAppRoutePath,
    pluginSidebar,
  });
  const [crashedSidebars, setCrashedSidebars] = useState<ReadonlySet<string>>(
    new Set(),
  );
  if (
    !holdCurrentMode &&
    (lastVisible.mode !== mode ||
      lastVisible.backToAppRoutePath !== backToAppRoutePath ||
      lastVisible.pluginSidebar !== pluginSidebar)
  ) {
    setLastVisible({ mode, backToAppRoutePath, pluginSidebar });
  }
  const rendered = holdCurrentMode
    ? lastVisible
    : { mode, backToAppRoutePath, pluginSidebar };
  const backTo =
    sidebarNavigationPlacement(navigation) === "list"
      ? rendered.backToAppRoutePath
      : null;

  const target = rendered.mode === "app" ? rendered.pluginSidebar : undefined;
  const panel = target?.panel;
  const SidebarComponent = panel?.experimental_sidebar;
  const sidebarKey =
    panel && target
      ? `${panel.pluginId}/${panel.id}/${panel.generation}/${target.subPath}`
      : null;
  const showPluginSidebar =
    SidebarComponent !== undefined &&
    sidebarKey !== null &&
    !crashedSidebars.has(sidebarKey);

  return (
    <AppSidebar
      onResizeMouseDown={onResizeMouseDown}
      isResizing={isResizing}
      isBodyHidden={rendered.mode !== "app" || showPluginSidebar}
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
        ) : showPluginSidebar && panel && target && SidebarComponent ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
            <PluginSlotMount
              key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
              pluginId={panel.pluginId}
              slotKind="navPanelSidebar"
              slotId={panel.id}
              crashResetKey={sidebarKey ?? undefined}
              crashFallback={null}
              onCrash={() => {
                if (sidebarKey !== null)
                  setCrashedSidebars((current) =>
                    new Set(current).add(sidebarKey),
                  );
              }}
            >
              <SidebarComponent subPath={target.subPath} />
            </PluginSlotMount>
          </div>
        ) : null
      }
    />
  );
}
