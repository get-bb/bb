import { useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { HbomRoutes } from "./hbom/hbom-routes.js";
import { BomScopeProvider } from "./sbom/component-card.js";
import { ComponentDetail } from "./sbom/component-detail.js";
import {
  EMPTY_SBOM_FILTERS,
  SHIPPED_VIEWS,
  SbomFilters,
  type SbomFiltersValue,
} from "./sbom/filters.js";
import { componentSubPath, parseBomSubPath } from "./sbom/routes.js";
import { SbomTable } from "./sbom/sbom-table.js";
import { bomAppRpcContract } from "../rpc.js";

function scopeValue(
  platformProjectId: string,
  projectVersionId: string,
): string {
  return `${encodeURIComponent(platformProjectId)}/${encodeURIComponent(projectVersionId)}`;
}

function BadBomRoute(): React.JSX.Element {
  const navigate = useBbNavigate();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wider text-destructive">
          BAD_ROUTE
        </p>
        <h2 className="mt-2 text-lg font-semibold">
          This BOM route is invalid
        </h2>
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
  const rpc = useRpc<typeof bomAppRpcContract>();
  const { projectId: routeProjectId } = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const route = parseBomSubPath(subPath);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [versions, setVersions] = useState<
    Array<{
      platformProjectId: string;
      projectVersionId: string;
      state: "fresh" | "stale";
    }>
  >([]);
  const [platformProjectId, setPlatformProjectId] = useState<string | null>(
    null,
  );
  const [projectVersionId, setProjectVersionId] = useState<string | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionRequest, setVersionRequest] = useState(0);
  const [filters, setFilters] = useState<SbomFiltersValue>(() =>
    route?.tab === "software" &&
    route.savedView &&
    SHIPPED_VIEWS[route.savedView]
      ? SHIPPED_VIEWS[route.savedView]
      : EMPTY_SBOM_FILTERS,
  );
  useEffect(() => {
    if (subPath.length > 0) return;
    navigate.toPluginPanel("bom", { subPath: "software", replace: true });
  }, [navigate, subPath]);
  const workspaceProjectId = routeProjectId ?? selectedProjectId;
  useEffect(() => {
    if (!workspaceProjectId || route?.tab !== "software") {
      setVersions([]);
      setPlatformProjectId(null);
      setProjectVersionId(null);
      setVersionsLoading(false);
      setVersionsError(null);
      return;
    }
    let active = true;
    setVersionsLoading(true);
    setVersionsError(null);
    void rpc
      .call("bomCachedProjectVersions", { projectId: workspaceProjectId })
      .then((result) => {
        if (!active) return;
        setVersions(result.versions);
        const selected =
          result.versions.find(
            (version) =>
              version.platformProjectId === result.selectedPlatformProjectId &&
              version.projectVersionId === result.selectedProjectVersionId,
          ) ?? result.versions[0];
        setPlatformProjectId(selected?.platformProjectId ?? null);
        setProjectVersionId(selected?.projectVersionId ?? null);
      })
      .catch((cause) => {
        if (!active) return;
        setVersions([]);
        setPlatformProjectId(null);
        setProjectVersionId(null);
        setVersionsError(
          cause instanceof Error
            ? cause.message
            : "Cached project versions could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setVersionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [route?.tab, rpc, versionRequest, workspaceProjectId]);
  if (!route) return <BadBomRoute />;
  const routeTabs = (
    <>
      <h1 className="sr-only">Bill of Materials</h1>
      <nav
        className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-card px-3"
        aria-label="Bill of Materials sections"
      >
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
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="bom-project"
          >
            Project
          </label>
          <select
            className="h-8 max-w-56 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={Boolean(routeProjectId) || sidebar.status === "loading"}
            id="bom-project"
            onChange={(event) => {
              const projectId = event.target.value || null;
              setSelectedProjectId(projectId);
              setVersions([]);
              setPlatformProjectId(null);
              setProjectVersionId(null);
              setVersionsError(null);
              setVersionsLoading(projectId !== null);
            }}
            value={workspaceProjectId ?? ""}
          >
            <option value="">Select project</option>
            {sidebar.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="bom-project-version"
          >
            Version
          </label>
          <select
            aria-label="Finite State project version"
            className="h-8 max-w-72 rounded-md border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={!workspaceProjectId || versionsLoading}
            id="bom-project-version"
            onChange={(event) => {
              const selected = versions.find(
                (version) =>
                  scopeValue(
                    version.platformProjectId,
                    version.projectVersionId,
                  ) === event.target.value,
              );
              setPlatformProjectId(selected?.platformProjectId ?? null);
              setProjectVersionId(selected?.projectVersionId ?? null);
            }}
            value={
              platformProjectId && projectVersionId
                ? scopeValue(platformProjectId, projectVersionId)
                : ""
            }
          >
            <option value="">
              {versionsLoading
                ? "Loading cached versions…"
                : versionsError
                  ? "Version lookup failed"
                  : "Select cached version"}
            </option>
            {versions.map((version) => (
              <option
                key={scopeValue(
                  version.platformProjectId,
                  version.projectVersionId,
                )}
                value={scopeValue(
                  version.platformProjectId,
                  version.projectVersionId,
                )}
              >
                {version.platformProjectId} / {version.projectVersionId}
                {version.state === "stale" ? " · stale" : ""}
              </option>
            ))}
          </select>
        </div>
      </nav>
    </>
  );
  if (route.tab === "hardware") {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {routeTabs}
        <div className="min-h-0 flex-1">
          <HbomRoutes route={route} />
        </div>
      </section>
    );
  }
  if (!workspaceProjectId || !platformProjectId || !projectVersionId) {
    return (
      <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
        {routeTabs}
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
            <Icon
              aria-hidden="true"
              className="size-6 text-muted-foreground"
              name="PackageReceive"
            />
            <h2 className="mt-4 text-lg font-semibold">
              {versionsError
                ? "Project versions unavailable"
                : "Choose an inventory scope"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {versionsError
                ? versionsError
                : "Select a bb project and one of its accepted cached project versions. Pull findings through Sync first when no version is available yet."}
            </p>
            {versionsError ? (
              <Button
                className="mt-4"
                onClick={() => setVersionRequest((current) => current + 1)}
                variant="outline"
              >
                Retry version lookup
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    );
  }
  return (
    <BomScopeProvider
      projectId={platformProjectId}
      projectVersionId={projectVersionId}
    >
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
        <div
          className={`grid min-h-0 flex-1 ${route.componentKey ? "grid-cols-12" : "grid-cols-1"}`}
        >
          <div
            className={route.componentKey ? "col-span-7 min-h-0" : "min-h-0"}
          >
            <SbomTable
              filters={filters}
              onOpen={(componentKey) =>
                navigate.toPluginPanel("bom", {
                  subPath: componentSubPath(componentKey),
                })
              }
              projectId={platformProjectId}
              projectVersionId={projectVersionId}
            />
          </div>
          {route.componentKey ? (
            <div className="col-span-5 min-h-0">
              <ComponentDetail
                id={route.componentKey}
                onClose={() =>
                  navigate.toPluginPanel("bom", { subPath: "software" })
                }
              />
            </div>
          ) : null}
        </div>
      </section>
    </BomScopeProvider>
  );
}
