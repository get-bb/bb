import {
  lazy,
  Suspense,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  PluginCreateButton,
  useCreatePlugin,
} from "@/components/plugin/PluginCreateButton";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SectionSidebar,
  SectionSidebarIcon,
  SectionSidebarLabel,
  SectionSidebarActionRow,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { canOpenNativeScreen, shellOpenNative } from "@/lib/native-shell";
import { getPluginsRoutePath } from "@/lib/route-paths";
import { getPluginSettingsEntryRoutePath } from "./plugin-settings-entries";
import { useCloseMobileSidebar } from "@/components/ui/sidebar";
import { useSettingsNavState } from "./settings-nav";
import type { SettingsNavState } from "./settings-nav";
import { getSettingsSectionRoutePath } from "./settings-sections";

const AddPluginDialog = lazy(() =>
  import("@/components/plugin/management/AddPluginDialog").then((module) => ({
    default: module.AddPluginDialog,
  })),
);

interface SettingsSidebarProps {
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  appRoutePath: string;
  mobileHosted?: boolean;
}

type SettingsSidebarNavigation = Pick<
  SettingsNavState,
  "activePluginId" | "activeSection" | "pluginEntries" | "sections"
>;

interface SettingsSidebarContentProps extends SettingsSidebarProps {
  navigation: SettingsSidebarNavigation;
  testIdPrefix?: string;
}

export function SettingsSidebarContent({
  onResizeMouseDown,
  isResizing,
  appRoutePath,
  mobileHosted,
  navigation,
  testIdPrefix = "settings",
}: SettingsSidebarContentProps) {
  const { activePluginId, activeSection, pluginEntries, sections } = navigation;
  const [installOpen, setInstallOpen] = useState(false);
  const createPlugin = useCreatePlugin();
  const closeMobileSidebar = useCloseMobileSidebar();

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      onResizeMouseDown={onResizeMouseDown}
      testIdPrefix={testIdPrefix}
    >
      <SectionSidebarLabel>Settings</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {sections
          .filter((section) => section.id !== "archived")
          .map((section) => (
            <SectionSidebarRow
              key={section.id}
              active={activeSection === section.id}
              label={section.label}
              to={getSettingsSectionRoutePath(section.id)}
            >
              <SectionSidebarIcon name={section.icon} />
            </SectionSidebarRow>
          ))}
      </div>
      <div className="mt-4">
        <SectionSidebarLabel>Plugins</SectionSidebarLabel>
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <Button asChild variant="link" size="sm" className="h-8 px-0 text-xs">
          <Link to={getPluginsRoutePath()} onClick={closeMobileSidebar}>
            Browse plugins
          </Link>
        </Button>
        <PluginCreateButton
          onCreate={(prompt) => {
            closeMobileSidebar();
            createPlugin(prompt);
          }}
          onInstallFromSource={() => {
            closeMobileSidebar();
            setInstallOpen(true);
          }}
        />
      </div>
      <div className="mt-1 space-y-0.5">
        {pluginEntries.map((entry) => (
          <SectionSidebarRow
            key={entry.id}
            active={activePluginId === entry.id}
            label={entry.label}
            to={getPluginSettingsEntryRoutePath(entry)}
          >
            <PluginIcon
              pluginId={entry.id}
              icon={entry.icon}
              className="size-4 shrink-0"
            />
          </SectionSidebarRow>
        ))}
      </div>
      {installOpen ? (
        <Suspense fallback={null}>
          <AddPluginDialog open onOpenChange={setInstallOpen} />
        </Suspense>
      ) : null}
      {canOpenNativeScreen() ? (
        <>
          <div className="mt-4">
            <SectionSidebarLabel>This phone</SectionSidebarLabel>
          </div>
          <div className="mt-1 space-y-0.5">
            <SectionSidebarActionRow
              label="This device"
              testId="settings-nav-native-device"
              onClick={() => shellOpenNative("device-settings")}
            >
              <SectionSidebarIcon name="Smartphone" />
            </SectionSidebarActionRow>
          </div>
        </>
      ) : null}
      {sections.some((section) => section.id === "archived") ? (
        <>
          <div className="mt-4">
            <SectionSidebarLabel>Archived</SectionSidebarLabel>
          </div>
          <div className="mt-1 space-y-0.5">
            {sections
              .filter((section) => section.id === "archived")
              .map((section) => (
                <SectionSidebarRow
                  key={section.id}
                  active={activeSection === section.id}
                  label={section.label}
                  to={getSettingsSectionRoutePath(section.id)}
                >
                  <SectionSidebarIcon name={section.icon} />
                </SectionSidebarRow>
              ))}
          </div>
        </>
      ) : null}
    </SectionSidebar>
  );
}

export function SettingsSidebar({
  onResizeMouseDown,
  isResizing,
  appRoutePath,
  mobileHosted,
}: SettingsSidebarProps) {
  const navigation = useSettingsNavState();

  return (
    <SettingsSidebarContent
      appRoutePath={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      navigation={navigation}
      onResizeMouseDown={onResizeMouseDown}
    />
  );
}
