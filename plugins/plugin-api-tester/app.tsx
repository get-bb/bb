import { definePluginApp } from "@get-bb/plugin-sdk/app";

function PluginApiTesterPanel() {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Plugin API Tester is active
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This placeholder panel is enabled by default in development and
            disabled by default in production.
          </p>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api-tester",
    title: "Plugin API Tester",
    icon: "Beaker",
    path: "plugin-api-tester",
    component: PluginApiTesterPanel,
  });
});
