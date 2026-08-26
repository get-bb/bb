import {
  definePluginApp,
  type ExperimentalPluginNavPanelMenuContext,
  type ExperimentalPluginNavPanelMenuItem,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";

const API_SURFACES = [
  { id: "agents", title: "Agents" },
  { id: "app-slots", title: "App slots" },
  { id: "storage", title: "Storage" },
] as const;

export async function loadApiSurfaceItems(
  context: ExperimentalPluginNavPanelMenuContext,
): Promise<readonly ExperimentalPluginNavPanelMenuItem[]> {
  // A real plugin can fetch or derive its current pages here. Function-form
  // submenu items are resolved by BB only when the submenu opens.
  await Promise.resolve();
  return API_SURFACES.map((surface) => ({
    id: surface.id,
    label: surface.title,
    run: () => context.navigate(`surfaces/${surface.id}`),
  }));
}

function NavPanelMenuPage({ subPath }: PluginNavPanelProps) {
  const activeSurface = subPath.startsWith("surfaces/")
    ? API_SURFACES.find((surface) => `surfaces/${surface.id}` === subPath)
        ?.title
    : undefined;

  return (
    <main className="h-full overflow-y-auto p-5 text-foreground">
      <div className="mx-auto max-w-2xl rounded-lg border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Nav panel menu example
        </p>
        <h1 className="mt-2 text-xl font-semibold">
          {activeSurface ?? "Overview"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use this page's sidebar menu to navigate, open a surface in split, or
          inspect the lazy API surfaces submenu.
        </p>
      </div>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "nav-panel-menu",
    title: "Nav panel menu",
    icon: "ListTree",
    path: "nav-panel-menu",
    component: NavPanelMenuPage,
    experimental_menu: [
      {
        id: "navigation",
        label: "Navigation",
        items: [
          {
            id: "overview",
            label: "Overview",
            icon: "House",
            description: "Open the example page root",
            run: (context) => context.navigate(""),
          },
          {
            id: "api-surfaces",
            label: "API surfaces",
            icon: "Library",
            items: loadApiSurfaceItems,
          },
        ],
      },
      {
        id: "workspace",
        label: "Workspace",
        items: [
          {
            id: "open-agents-in-split",
            label: "Open Agents in split",
            icon: "PanelRightOpen",
            run: (context) => context.openInSplit("surfaces/agents"),
          },
        ],
      },
    ],
  });
});
