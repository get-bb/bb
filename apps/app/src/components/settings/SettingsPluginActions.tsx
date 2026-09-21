import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  PluginCreateButton,
  useCreatePlugin,
} from "@/components/plugin/PluginCreateButton";
import { getPluginsRoutePath } from "@/lib/route-paths";

const AddPluginDialog = lazy(() =>
  import("@/components/plugin/management/AddPluginDialog").then((module) => ({
    default: module.AddPluginDialog,
  })),
);

export function SettingsPluginActions() {
  const [installOpen, setInstallOpen] = useState(false);
  const createPlugin = useCreatePlugin();

  return (
    <div
      className="flex items-center justify-between gap-2"
      role="group"
      aria-label="Plugin management"
    >
      <Button asChild variant="link" size="sm" className="h-8 px-0 text-xs">
        <Link to={getPluginsRoutePath()}>Browse plugins</Link>
      </Button>
      <PluginCreateButton
        onCreate={createPlugin}
        onInstallFromSource={() => setInstallOpen(true)}
      />
      {installOpen ? (
        <Suspense fallback={null}>
          <AddPluginDialog open onOpenChange={setInstallOpen} />
        </Suspense>
      ) : null}
    </div>
  );
}
