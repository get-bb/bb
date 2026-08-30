import {
  definePluginApp,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";

function PluginApiTesterPanel({ subPath }: PluginNavPanelProps) {
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
          <p className="mt-1 text-sm text-muted-foreground">
            Current sub-path: {subPath}
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
    experimental_sidebarSubItems: [
      {
        id: "overview",
        title: "Overview",
        icon: "Beaker",
        subPath: "overview",
      },
      {
        id: "activity",
        title: "Activity",
        subPath: "activity",
        experimental_sidebarAccessory: () => <span>3</span>,
      },
    ],
  });
});
