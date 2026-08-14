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
import { architectureCacheSignals } from "../canvas/nodes/cacheMessage.js";
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
  CanvasDiagnosticsState,
  CanvasEmptyState,
  CanvasErrorState,
  CanvasLoadingState,
  CanvasRefreshFailureState,
  CanvasUnconfiguredState,
} from "./states.js";
import { isVerificationTier } from "../verifications/matrix/status.js";
import { ThreatOverlayVisibilityProvider } from "../canvas/threat-overlay/visibility.js";
import {
  taraScopeVersionKey,
  useResolvedTaraScope,
  type ResolvedTaraScope,
  type TaraScopeState,
} from "../canvas/scope/index.js";

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
  scope: ResolvedTaraScope;
  focusId: string | null;
  onFocusRoute(kind: ArchitectureSelectionKind, slug: string): void;
  onRepairSourceFile(sourceFile: string, slug: string): void;
}

function LegacyPromotionNotice({
  scopeState,
  versionId,
  onVersionIdChange,
}: {
  scopeState: TaraScopeState;
  versionId: string;
  onVersionIdChange(value: string): void;
}): React.JSX.Element | null {
  if (!scopeState.legacy) return null;
  return (
    <div className="border-b border-border bg-card px-4 py-3">
      <p className="text-sm font-medium text-foreground">
        Promote legacy TARA to a version
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        The associated Platform project {scopeState.legacy.platformProjectId}{" "}
        has a project-scoped snapshot. Promotion copies every accepted kind
        together and refuses a non-empty target.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="tara-promotion-version">
          Target version ID
        </label>
        <input
          className="h-9 min-w-52 rounded-md border border-input bg-background px-3 text-sm"
          id="tara-promotion-version"
          onChange={(event) => onVersionIdChange(event.target.value)}
          placeholder="Target version ID"
          value={versionId}
        />
        <button
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={scopeState.promoting || versionId.trim().length === 0}
          onClick={() => void scopeState.promote(versionId.trim())}
          type="button"
        >
          {scopeState.promoting ? "Promoting…" : "Promote complete snapshot"}
        </button>
      </div>
    </div>
  );
}

function TaraPanel({
  features,
  workspaceProjectId,
  scopeState,
  detail,
}: {
  features: ProductSecurityFeatures;
  workspaceProjectId: string | null;
  scopeState: TaraScopeState;
  detail: readonly string[];
}): React.JSX.Element {
  const navigate = useBbNavigate();
  const [promotionVersionId, setPromotionVersionId] = useState("");
  const [localAuthoringRequest, setLocalAuthoringRequest] = useState(0);
  const scope = scopeState.scope;
  const data = useArchitectureData(scope);
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
            scope: canvasScope,
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
                  projectId={`${canvasScope.platformProjectId}:${canvasScope.projectVersionId}`}
                  scope={canvasScope}
                />
              </nodeModule.ProductSecurityCanvasWorkspace>
            );
          },
        };
      }),
    [features],
  );

  if (!workspaceProjectId) {
    return <CanvasUnconfiguredState />;
  }
  if (scopeState.status === "loading") return <CanvasLoadingState />;
  if (scopeState.status === "unconfigured") {
    return <CanvasUnconfiguredState />;
  }
  if (scopeState.status === "error" || !scope) {
    return <CanvasErrorState onRetry={scopeState.retry} />;
  }
  if (data.status === "unconfigured") return <CanvasUnconfiguredState />;
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
    const cacheSignals = architectureCacheSignals(data.model.cache.message);
    return (
      <div className="relative h-full min-h-0">
        <LegacyPromotionNotice
          onVersionIdChange={setPromotionVersionId}
          scopeState={scopeState}
          versionId={promotionVersionId}
        />
        {scopeState.promotionMessage ? (
          <div
            className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
            role="status"
          >
            {scopeState.promotionMessage}
          </div>
        ) : null}
        {data.error ? (
          <CanvasErrorState onRetry={data.retry} />
        ) : cacheSignals.fileDiagnostics ? (
          <CanvasDiagnosticsState
            message={cacheSignals.fileDiagnostics}
            onRetry={data.retry}
            refreshFailed={cacheSignals.refreshFailed}
          />
        ) : cacheSignals.refreshFailed ? (
          <CanvasRefreshFailureState onRetry={data.retry} />
        ) : (
          <CanvasEmptyState
            onContinueLocalAuthoring={() =>
              setLocalAuthoringRequest((request) => request + 1)
            }
            onRetry={data.retry}
          />
        )}
        <EditingLayer createRequest={localAuthoringRequest} scope={scope} />
      </div>
    );
  }

  const model: ArchitectureModel = data.error
    ? { ...data.model, cache: { ...data.model.cache, stale: true } }
    : data.model;
  const graph = data.graph;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <LegacyPromotionNotice
        onVersionIdChange={setPromotionVersionId}
        scopeState={scopeState}
        versionId={promotionVersionId}
      />
      {scopeState.promotionMessage ? (
        <div
          className="border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
          role="status"
        >
          {scopeState.promotionMessage}
        </div>
      ) : null}
      <CanvasCacheBanner
        error={data.error}
        message={model.cache.message}
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
            scope={scope}
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
  const taraScope = useResolvedTaraScope(
    route.tab === "tara" ? projectId : null,
  );
  const RequirementsCards = features.RequirementsCards;
  const RequirementsTraceabilityLayer = features.RequirementsTraceabilityLayer;
  const RequirementsConversionLayer = features.RequirementsConversionLayer;
  const VerificationMatrix = features.VerificationMatrix;
  const VerificationRunDetailLayer = features.VerificationRunDetailLayer;
  const verificationTier = route.detail[1];
  const isVerificationRunDetail =
    route.detail.length === 2 &&
    Boolean(route.detail[0]) &&
    verificationTier !== undefined &&
    verificationTier !== "hardware" &&
    isVerificationTier(verificationTier);
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
          {route.tab === "tara" && projectId ? (
            <>
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="product-security-version"
              >
                Version
              </label>
              <select
                aria-label="TARA version"
                className="h-9 max-w-64 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                disabled={
                  taraScope.status !== "ready" || taraScope.versions.length <= 1
                }
                id="product-security-version"
                onChange={(event) => taraScope.select(event.target.value)}
                value={taraScope.selectedKey}
              >
                {taraScope.status === "loading" ? (
                  <option value="">Resolving accepted version…</option>
                ) : null}
                {taraScope.scope?.mode === "local" ? (
                  <option value="">Local working model</option>
                ) : null}
                {taraScope.versions.map((version) => (
                  <option
                    key={taraScopeVersionKey(version)}
                    value={taraScopeVersionKey(version)}
                  >
                    {taraScope.versions.some(
                      (candidate) =>
                        candidate.platformProjectId !==
                        version.platformProjectId,
                    )
                      ? `${version.platformProjectId} · `
                      : ""}
                    {version.projectVersionId}
                  </option>
                ))}
              </select>
            </>
          ) : null}
        </div>
      </nav>
      <ThreatOverlayVisibilityProvider>
        <div className="min-h-0 flex-1">
          {route.tab === "tara" ? (
            <TaraPanel
              detail={route.detail}
              features={features}
              scopeState={taraScope}
              workspaceProjectId={projectId}
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
            isVerificationRunDetail ? (
              <VerificationRunDetailLayer
                detail={route.detail}
                projectId={projectId}
              />
            ) : (
              <VerificationMatrix projectId={projectId} />
            )
          ) : null}
          {route.tab !== "tara" && !projectId ? (
            <CanvasUnconfiguredState />
          ) : null}
        </div>
      </ThreatOverlayVisibilityProvider>
    </section>
  );
}
