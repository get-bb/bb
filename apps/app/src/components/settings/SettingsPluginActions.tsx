import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  PluginCreateButton,
  useCreatePlugin,
} from "@/components/plugin/PluginCreateButton";
import { useCloseMobileSidebar } from "@/components/ui/sidebar";
import { getPluginsRoutePath } from "@/lib/route-paths";

const AddPluginDialog = lazy(() =>
  import("@/components/plugin/management/AddPluginDialog").then((module) => ({
    default: module.AddPluginDialog,
  })),
);

export function SettingsPluginActions() {
  const [installOpen, setInstallOpen] = useState(false);
  const createPlugin = useCreatePlugin();
  const closeMobileSidebar = useCloseMobileSidebar();

  return (
    <>
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
      {installOpen ? (
        <Suspense fallback={null}>
          <AddPluginDialog open onOpenChange={setInstallOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
