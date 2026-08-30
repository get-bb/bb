import {
  definePluginApp,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";

function PluginApiTesterPanel({ subPath }: PluginNavPanelProps) {
  const section = subPath.split("/")[0];
  const sectionTitle =
    section === "overview"
      ? "Overview"
      : section === "activity"
        ? "Activity"
        : "Panel root";

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Plugin API Tester is active
          </p>
          <h2 className="mt-3 text-lg font-semibold text-foreground">
            {sectionTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Expand this plugin in the sidebar to test child navigation, icons,
            parent and child accessories, and active route highlighting.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Current sub-path: {subPath}
          </p>
        </div>
      </div>
    </div>
  );
}

function ParentSidebarAccessory() {
  return <span>API</span>;
}

function ActivitySidebarAccessory() {
  return <span>3</span>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api-tester",
    title: "Plugin API Tester",
    icon: "Beaker",
    path: "plugin-api-tester",
    component: PluginApiTesterPanel,
    experimental_sidebarAccessory: ParentSidebarAccessory,
    experimental_sidebarSubItems: [
      {
        id: "overview",
        title: "Overview",
        icon: "Info",
        subPath: "overview",
      },
      {
        id: "activity",
        title: "Activity",
        icon: "Workflow",
        subPath: "activity",
        experimental_sidebarAccessory: ActivitySidebarAccessory,
      },
    ],
  });
});
