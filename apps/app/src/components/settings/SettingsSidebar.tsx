import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  Sidebar,
  SidebarContent,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar.js";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { SIDEBAR_STANDARD_ROW_PADDING_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import {
  CHROME_ROW_CLASS,
  getBbDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  SETTINGS_ROUTE_PATH,
  getRootComposeRoutePath,
  getSettingsPluginRoutePath,
  getSettingsProviderRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";
import { PluginNavIcon, useSettingsNavState } from "./settings-nav";
import { getProviderIconInfo } from "@/lib/provider-icon";

interface SettingsSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  showTopReserve: boolean;
}

interface SettingsSidebarRowProps {
  active: boolean;
  children: ReactNode;
  label: string;
  onNavigate: () => void;
  to: string;
}

// Same row recipe as the app sidebar's primary actions and plugin nav rows,
// including their active treatment, so both sidebar modes share one rhythm.
function SettingsSidebarRow({
  active,
  children,
  label,
  onNavigate,
  to,
}: SettingsSidebarRowProps) {
  return (
    <Button
      asChild
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full",
        active && "bg-sidebar-accent text-sidebar-foreground",
      )}
    >
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
      >
        {children}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      </Link>
    </Button>
  );
}

function SettingsSidebarSectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        CHROME_SECTION_LABEL_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Replaces the app sidebar while a /settings route is active: "Back to app"
 * on top, then the settings buckets, then a "Plugins" group with one entry
 * per enabled plugin that declares settings. Shares the app sidebar's shell
 * (top chrome reserve, resize handle) and its row/label class tokens so the
 * two sidebar modes line up exactly.
 */
export function SettingsSidebar({
  onResizeMouseDown,
  isResizing,
  showTopReserve,
}: SettingsSidebarProps) {
  const closeOnMobile = useCloseMobileSidebar();
  const [desktopInfo] = useState(getBbDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const {
    activePluginId,
    activeProviderId,
    activeSection,
    pluginEntries,
    providerEntries,
    sections,
  } = useSettingsNavState();

  const sectionIcon = (name: IconName) => (
    <Icon name={name} className={COARSE_POINTER_ICON_SIZE_CLASS} />
  );

  return (
    <Sidebar>
      {showTopReserve ? (
        // Mirrors the app sidebar's top reserve (see AppSidebar) so the
        // chrome row, drag strip, and history controls stay put when the
        // sidebar swaps between app and settings modes.
        <div
          data-testid="settings-sidebar-top-reserve-row"
          className={cn(
            CHROME_ROW_CLASS,
            "shrink-0 justify-end px-2",
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        >
          <SidebarHistoryNavigationControls
            onNavigate={closeOnMobile}
            className={cn(
              "group-data-[collapsible=icon]:hidden",
              usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
            )}
          />
        </div>
      ) : null}
      <div className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden">
        <div className="space-y-1">
          <SettingsSidebarRow
            active={false}
            label="Back to app"
            onNavigate={closeOnMobile}
            to={getRootComposeRoutePath()}
          >
            {sectionIcon("ChevronLeft")}
          </SettingsSidebarRow>
        </div>
      </div>
      <SidebarContent>
        <div className="min-w-0 px-2 group-data-[collapsible=icon]:hidden">
          <SettingsSidebarSectionLabel>Settings</SettingsSidebarSectionLabel>
          <div className="mt-1 space-y-0.5">
            {sections.map((section) => (
              <SettingsSidebarRow
                key={section.id}
                active={activeSection === section.id}
                label={section.label}
                onNavigate={closeOnMobile}
                to={
                  section.id === "general"
                    ? SETTINGS_ROUTE_PATH
                    : getSettingsRoutePath(section.id)
                }
              >
                {sectionIcon(section.icon)}
              </SettingsSidebarRow>
            ))}
          </div>
          <div className="mt-4">
            <SettingsSidebarSectionLabel>Providers</SettingsSidebarSectionLabel>
          </div>
          <div className="mt-1 space-y-0.5">
            {providerEntries.map((provider) => {
              const ProviderIcon = getProviderIconInfo(provider.id)?.icon;
              return (
                <SettingsSidebarRow
                  key={provider.id}
                  active={activeProviderId === provider.id}
                  label={provider.label}
                  onNavigate={closeOnMobile}
                  to={getSettingsProviderRoutePath(provider.id)}
                >
                  {ProviderIcon ? (
                    <ProviderIcon className={COARSE_POINTER_ICON_SIZE_CLASS} />
                  ) : (
                    sectionIcon("Code")
                  )}
                </SettingsSidebarRow>
              );
            })}
          </div>
          {pluginEntries.length > 0 ? (
            <>
              <div className="mt-4">
                <SettingsSidebarSectionLabel>
                  Plugins
                </SettingsSidebarSectionLabel>
              </div>
              <div className="mt-1 space-y-0.5">
                {pluginEntries.map((plugin) => (
                  <SettingsSidebarRow
                    key={plugin.id}
                    active={activePluginId === plugin.id}
                    label={plugin.displayName ?? plugin.id}
                    onNavigate={closeOnMobile}
                    to={getSettingsPluginRoutePath(plugin.id)}
                  >
                    <PluginNavIcon plugin={plugin} />
                  </SettingsSidebarRow>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </SidebarContent>
      <div
        data-testid="settings-sidebar-resize-handle"
        className={cn(
          "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          "group-data-[collapsible=icon]:hidden",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={onResizeMouseDown}
      />
    </Sidebar>
  );
}
