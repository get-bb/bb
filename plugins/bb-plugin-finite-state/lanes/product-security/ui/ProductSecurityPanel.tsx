import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
import type { NodeTypes } from "@xyflow/react";
import { Icon } from "@bb/shared-ui/icon";
import {
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import type { CanvasFoundationFeatures } from "../canvas/foundation/CanvasShell.js";
import type { CanvasModel } from "../canvas/foundation/types.js";
import { useArchitectureData } from "../canvas/nodes/useNodeData.js";
import { toFoundationCanvasModel } from "../canvas/nodes/index.js";
import type {
  ArchitectureAdjacency,
  ArchitectureModel,
  CanvasArchitectureGraph,
} from "../canvas/nodes/adapters.js";
import {
  focusIdFromRoute,
  focusSubPath,
  type ArchitectureSelectionKind,
} from "../canvas/nodes/selection.js";
import {
  parseProductSecurityRoute,
  PRODUCT_SECURITY_TABS,
  productSecuritySubPath,
  type ProductSecurityTab,
} from "./route.js";
import {
  CanvasCacheBanner,
  CanvasEmptyState,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasUnconfiguredState,
} from "./states.js";
import { isVerificationTier } from "../verifications/matrix/status.js";

const PROJECT_SCOPE_STORAGE_KEY =
  "finite-state:product-security:project-scope:v1";

interface ProjectScopedLaneProps {
  projectId: string;
  detail?: readonly string[];
}

export interface ProductSecurityFeatures extends Omit<
  CanvasFoundationFeatures,
  "nodeTypes"
> {
  loadNodeTypes(): Promise<NodeTypes>;
  RequirementsCards: ComponentType<ProjectScopedLaneProps>;
  RequirementsTraceabilityLayer: ComponentType<ProjectScopedLaneProps>;
  RequirementsConversionLayer: ComponentType<ProjectScopedLaneProps>;
  VerificationMatrix: ComponentType<ProjectScopedLaneProps>;
  VerificationRunDetailLayer: ComponentType<ProjectScopedLaneProps>;
}

interface ProductSecurityPanelProps extends PluginNavPanelProps {
  features: ProductSecurityFeatures;
}

function readPersistedProjectId(): string | null {
  try {
    const value = localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function persistProjectId(projectId: string): void {
  try {
    localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, projectId);
  } catch {
    // Project scope still works for this mount when storage is unavailable.
  }
}

interface LoadedArchitectureCanvasProps {
  model: ArchitectureModel;
  graph: CanvasArchitectureGraph;
  adjacency: ReadonlyMap<string, ArchitectureAdjacency>;
  foundationModel: CanvasModel;
  projectId: string;
  focusId: string | null;
  onFocusRoute(kind: ArchitectureSelectionKind, slug: string): void;
  onRepairSourceFile(sourceFile: string, slug: string): void;
}

function TaraPanel({
  features,
  projectId,
  detail,
}: {
  features: ProductSecurityFeatures;
  projectId: string | null;
  detail: readonly string[];
}): React.JSX.Element {
  const navigate = useBbNavigate();
  const data = useArchitectureData(projectId);
  const focusId = focusIdFromRoute(detail);
  const foundationModel = useMemo(
    () =>
      data.model && data.graph
        ? toFoundationCanvasModel(data.model, data.graph)
        : null,
    [data.graph, data.model],
  );
  const onFocusRoute = useCallback(
    (kind: ArchitectureSelectionKind, slug: string) => {
      navigate.toPluginPanel("product-security", {
        subPath: focusSubPath(kind, slug),
      });
    },
    [navigate],
  );
  const onRepairSourceFile = useCallback(
    (sourceFile: string, slug: string) => {
      navigate.toCompose({
        initialPrompt: `@${sourceFile} — inspect/repair the unresolved reference for ${slug}`,
        focusPrompt: true,
      });
    },
    [navigate],
  );
  const LazyArchitectureCanvas = useMemo(
    () =>
      lazy(async () => {
        const [foundationModule, nodeModule, nodeTypes] = await Promise.all([
          import("../canvas/foundation/CanvasShell.js"),
          import("../canvas/nodes/index.js"),
          features.loadNodeTypes(),
        ]);
        const LoadedCanvasShell = foundationModule.default;
        return {
          default({
            model,
            graph,
            adjacency,
            foundationModel,
            projectId: canvasProjectId,
            focusId: canvasFocusId,
            onFocusRoute: focusRoute,
            onRepairSourceFile: repairSourceFile,
          }: LoadedArchitectureCanvasProps): React.JSX.Element {
            return (
              <nodeModule.ProductSecurityCanvasWorkspace
                adjacency={adjacency}
                focusId={canvasFocusId}
                graph={graph}
                key={canvasFocusId ?? "architecture-canvas"}
                model={model}
                onFocusRoute={focusRoute}
                onRepairSourceFile={repairSourceFile}
              >
                <LoadedCanvasShell
                  features={{
                    nodeTypes,
                    edgeTypes: {
                      ...features.edgeTypes,
                      ...nodeModule.productSecurityNodeEdgeTypes,
                    },
                    ThreatOverlay: features.ThreatOverlay,
                    LinksLayer: features.LinksLayer,
                    EditingLayer: features.EditingLayer,
                  }}
                  model={foundationModel}
                  projectId={canvasProjectId}
                />
              </nodeModule.ProductSecurityCanvasWorkspace>
            );
          },
        };
      }),
    [features],
  );

  if (!projectId || data.status === "unconfigured") {
    return <CanvasUnconfiguredState />;
  }
  if (data.status === "loading") return <CanvasLoadingState />;
  if (
    data.status === "error" ||
    !data.model ||
    !data.graph ||
    !data.adjacency ||
    !foundationModel
  ) {
    return <CanvasErrorState onRetry={data.retry} />;
  }
  if (data.model.nodes.length === 0) {
    const EditingLayer = features.EditingLayer;
    return (
      <div className="relative h-full min-h-0">
        <CanvasEmptyState onRetry={data.retry} />
        <EditingLayer />
      </div>
    );
  }

  const model: ArchitectureModel = data.error
    ? { ...data.model, cache: { ...data.model.cache, stale: true } }
    : data.model;
  const graph = data.graph;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CanvasCacheBanner
        error={data.error}
        pulledAt={model.cache.pulledAt}
        stale={model.cache.stale}
      />
      {graph.unresolved.length > 0 ? (
        <div
          className="flex items-center gap-2 border-b border-destructive/40 bg-muted px-4 py-2 text-sm text-foreground"
          role="status"
        >
          <Icon
            aria-hidden="true"
            className="size-4 text-destructive"
            name="CircleX"
          />
          Partial architecture: {graph.unresolved.length} unresolved slug{" "}
          {graph.unresolved.length === 1 ? "reference" : "references"}. Valid
          entities remain inspectable.
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <Suspense fallback={<CanvasLoadingState />}>
          <LazyArchitectureCanvas
            adjacency={data.adjacency}
            focusId={focusId}
            foundationModel={foundationModel}
            graph={graph}
            model={model}
            onFocusRoute={onFocusRoute}
            onRepairSourceFile={onRepairSourceFile}
            projectId={projectId}
          />
        </Suspense>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<ProductSecurityTab, string> = {
  tara: "TARA",
  requirements: "Requirements",
  verifications: "Verifications",
};

export function ProductSecurityPanel({
  subPath,
  features,
}: ProductSecurityPanelProps): React.JSX.Element {
  const navigate = useBbNavigate();
  const { projectId: routeProjectId } = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const [selectedProjectId, setSelectedProjectId] = useState(
    readPersistedProjectId,
  );
  const route = parseProductSecurityRoute(subPath);
  useEffect(() => {
    if (!routeProjectId) return;
    persistProjectId(routeProjectId);
  }, [routeProjectId]);
  const selectedProjectExists = sidebar.projects.some(
    (project) => project.id === selectedProjectId,
  );
  const fallbackProjectId =
    selectedProjectId && (sidebar.status !== "ready" || selectedProjectExists)
      ? selectedProjectId
      : null;
  const projectId = routeProjectId ?? fallbackProjectId;
  const RequirementsCards = features.RequirementsCards;
  const RequirementsTraceabilityLayer = features.RequirementsTraceabilityLayer;
  const RequirementsConversionLayer = features.RequirementsConversionLayer;
  const VerificationMatrix = features.VerificationMatrix;
  const VerificationRunDetailLayer = features.VerificationRunDetailLayer;
  const verificationTier = route.detail[1];
  const isVerificationRunDetail = route.detail.length === 2
    && Boolean(route.detail[0])
    && verificationTier !== undefined
    && verificationTier !== "hardware"
    && isVerificationTier(verificationTier);
  return (
    <section
      aria-label="Product Security"
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <nav
        aria-label="Product Security sections"
        className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2"
      >
        {PRODUCT_SECURITY_TABS.map((tab) => (
          <button
            aria-current={route.tab === tab ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              route.tab === tab
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            key={tab}
            onClick={() =>
              navigate.toPluginPanel("product-security", {
                subPath: productSecuritySubPath(tab),
              })
            }
            type="button"
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor="product-security-project"
          >
            Project
          </label>
          <select
            aria-label="Product Security project"
            className="h-9 max-w-64 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            disabled={Boolean(routeProjectId) || sidebar.status === "loading"}
            id="product-security-project"
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setSelectedProjectId(nextProjectId || null);
              if (nextProjectId) persistProjectId(nextProjectId);
            }}
            value={projectId ?? ""}
          >
            <option value="">Select a project</option>
            {sidebar.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      </nav>
      <div className="min-h-0 flex-1">
        {route.tab === "tara" ? (
          <TaraPanel
            detail={route.detail}
            features={features}
            projectId={projectId}
          />
        ) : null}
        {route.tab === "requirements" && projectId ? (
          <>
            {route.detail[0] === "trace" ? (
              <RequirementsTraceabilityLayer
                detail={route.detail}
                projectId={projectId}
              />
            ) : (
              <RequirementsCards projectId={projectId} />
            )}
            <RequirementsConversionLayer projectId={projectId} />
          </>
        ) : null}
        {route.tab === "verifications" && projectId ? (
          isVerificationRunDetail
            ? <VerificationRunDetailLayer detail={route.detail} projectId={projectId} />
            : <VerificationMatrix projectId={projectId} />
        ) : null}
        {route.tab !== "tara" && !projectId ? (
          <CanvasUnconfiguredState />
        ) : null}
      </div>
    </section>
  );
}
