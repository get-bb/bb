import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Icon } from "@bb/shared-ui/icon";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { HbomRoutes } from "./hbom/hbom-routes.js";
import {
  BomScopeProvider,
} from "./sbom/component-card.js";
import { ComponentDetail } from "./sbom/component-detail.js";
import {
  EMPTY_SBOM_FILTERS,
  SHIPPED_VIEWS,
  SbomFilters,
  type SbomFiltersValue,
} from "./sbom/filters.js";
import {
  componentSubPath,
  parseBomSubPath,
} from "./sbom/routes.js";
import { SbomTable } from "./sbom/sbom-table.js";

function BadBomRoute(): React.JSX.Element {
  const navigate = useBbNavigate();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wider text-destructive">
          BAD_ROUTE
        </p>
        <h2 className="mt-2 text-lg font-semibold">This BOM route is invalid</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Component identities must use the bounded, canonical route-key
          encoding. No request was sent for this value.
        </p>
        <button
          className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() =>
            navigate.toPluginPanel("bom", {
              subPath: "software",
              replace: true,
            })
          }
          type="button"
        >
          Return to software
        </button>
      </div>
    </div>
  );
}

export function BomPanel({ subPath }: PluginNavPanelProps): React.JSX.Element {
  const navigate = useBbNavigate();
  const { projectId: routeProjectId } = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const route = parseBomSubPath(subPath);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectVersionId, setProjectVersionId] = useState("");
  const [filters, setFilters] = useState<SbomFiltersValue>(() =>
    route?.tab === "software" && route.savedView && SHIPPED_VIEWS[route.savedView]
      ? SHIPPED_VIEWS[route.savedView]
      : EMPTY_SBOM_FILTERS,
  );
  useEffect(() => {
    if (subPath.length > 0) return;
    navigate.toPluginPanel("bom", { subPath: "software", replace: true });
  }, [navigate, subPath]);
  if (!route) return <BadBomRoute />;
  const projectId = routeProjectId ?? selectedProjectId;
  const routeTabs = (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-3" aria-label="Bill of Materials sections">
      <Button
        aria-current={route.tab === "software" ? "page" : undefined}
        onClick={() => navigate.toPluginPanel("bom", { subPath: "software" })}
        size="sm"
        variant={route.tab === "software" ? "secondary" : "ghost"}
      >
        Software
      </Button>
      <Button
        aria-current={route.tab === "hardware" ? "page" : undefined}
        onClick={() => navigate.toPluginPanel("bom", { subPath: "hardware" })}
        size="sm"
        variant={route.tab === "hardware" ? "secondary" : "ghost"}
      >
        Hardware
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="bom-project">Project</label>
        <select
          className="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          disabled={Boolean(routeProjectId) || sidebar.status === "loading"}
          id="bom-project"
          onChange={(event) => setSelectedProjectId(event.target.value || null)}
          value={projectId ?? ""}
        >
          <option value="">Select project</option>
          {sidebar.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="bom-project-version">Version</label>
        <Input
          aria-label="Finite State project version ID"
          className="h-8 w-52 font-mono text-xs"
          id="bom-project-version"
          onChange={(event) => setProjectVersionId(event.target.value)}
          placeholder="Project version ID"
          value={projectVersionId}
        />
      </div>
    </nav>
  );
  if (route.tab === "hardware") {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {routeTabs}
        <div className="min-h-0 flex-1"><HbomRoutes route={route} /></div>
      </section>
    );
  }
  if (!projectId || projectVersionId.trim().length === 0) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {routeTabs}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
            <Icon aria-hidden="true" className="size-6 text-muted-foreground" name="PackageReceive" />
            <h2 className="mt-4 text-lg font-semibold">Choose an inventory scope</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Select the bb project and enter its Finite State project-version ID. The frozen v1 RPC is version-scoped and does not expose a version catalog.
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <BomScopeProvider projectId={projectId} projectVersionId={projectVersionId.trim()}>
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {routeTabs}
        <SbomFilters
          activeView={route.savedView}
          onChange={setFilters}
          onView={(view) => {
            const shipped = SHIPPED_VIEWS[view];
            if (shipped) setFilters(shipped);
            navigate.toPluginPanel("bom", {
              subPath: `software/view/${encodeURIComponent(view)}`,
            });
          }}
          value={filters}
        />
        <div className={`grid min-h-0 flex-1 ${route.componentKey ? "grid-cols-12" : "grid-cols-1"}`}>
          <div className={route.componentKey ? "col-span-7 min-h-0" : "min-h-0"}>
            <SbomTable
              filters={filters}
              onOpen={(componentKey) => navigate.toPluginPanel("bom", {
                subPath: componentSubPath(componentKey),
              })}
              projectId={projectId}
              projectVersionId={projectVersionId.trim()}
            />
          </div>
          {route.componentKey ? (
            <div className="col-span-5 min-h-0">
              <ComponentDetail
                id={route.componentKey}
                onClose={() => navigate.toPluginPanel("bom", { subPath: "software" })}
              />
            </div>
          ) : null}
        </div>
      </section>
    </BomScopeProvider>
  );
}
