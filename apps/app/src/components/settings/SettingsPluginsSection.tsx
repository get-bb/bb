import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  PluginCreateButton,
  useCreatePlugin,
} from "@/components/plugin/PluginCreateButton";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import {
  getPluginSettingsEntryRoutePath,
  type PluginSettingsEntry,
} from "./plugin-settings-entries";
import { useCloseMobileSidebar } from "@/components/ui/sidebar";
import { getPluginsRoutePath } from "@/lib/route-paths";

const AddPluginDialog = lazy(() =>
  import("@/components/plugin/management/AddPluginDialog").then((module) => ({
    default: module.AddPluginDialog,
  })),
);

export function SettingsPluginsSection({
  activePluginId,
  pluginEntries,
}: {
  activePluginId: string | null;
  pluginEntries: readonly PluginSettingsEntry[];
}) {
  const [installOpen, setInstallOpen] = useState(false);
  const createPlugin = useCreatePlugin();
  const closeMobileSidebar = useCloseMobileSidebar();

  return (
    <>
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
    </>
  );
}
