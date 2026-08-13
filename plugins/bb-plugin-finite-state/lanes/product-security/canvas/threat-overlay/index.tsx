import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  EdgeLabelRenderer,
  NodeToolbar,
  Position,
  useInternalNode,
  useReactFlow,
} from "@xyflow/react";
import { Icon } from "@bb/shared-ui/icon";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@bb/plugin-sdk/app";
import type { z } from "zod";
import { useArchitectureSelection } from "../nodes/selection.js";
import type { threatOverlayRpcContract } from "./backend.js";
import {
  aggregatesByTarget,
  type StrideSegment,
  type ThreatAggregate,
  type ThreatSummary,
} from "./aggregate.js";
import {
  AttackPathOverlay,
  type AttackPathSummary,
} from "./AttackPathOverlay.js";
import { StrideMicroBar } from "./StrideMicroBar.js";
import { ThreatLegend } from "./ThreatLegend.js";
import { ThreatTable } from "./ThreatTable.js";
import {
  resolveAttackPath,
  type ResolvedAttackPath,
} from "./path.js";
import {
  EMPTY_THREAT_SELECTION,
  isProgrammaticSelectionSnapshot,
  reduceThreatSelection,
  threatSelectionKey,
  threatFocusSubPath,
  threatSlugFromPathname,
} from "./selection.js";

const PROJECT_SCOPE_STORAGE_KEY =
  "finite-state:product-security:project-scope:v1";

type Snapshot = z.output<
  (typeof threatOverlayRpcContract)["threatOverlaySnapshot"]["output"]
>;
type PathPage = z.output<
  (typeof threatOverlayRpcContract)["threatOverlayPaths"]["output"]
>;
type PathResult = z.output<
  (typeof threatOverlayRpcContract)["threatOverlayPath"]["output"]
>;
const EMPTY_THREATS: Snapshot["threats"] = [];
const EMPTY_AGGREGATES: Snapshot["aggregates"] = [];

interface ProductSecurityThreatOverlayProps {
  projectId?: string | null;
  focus?: string | null;
  highlight?: string | null;
}

interface SnapshotState {
  projectId: string | null;
  data: Snapshot | null;
  loading: boolean;
  error: string | null;
}

interface StoredSnapshotState extends SnapshotState {
  completedRequestRevision: number;
}

interface PathListState {
  threatSlug: string | null;
  items: AttackPathSummary[];
  total: number;
  next: string | null;
  loading: boolean;
  error: string | null;
}

interface PathDetailState {
  routeSignature: string | null;
  result: PathResult | null;
  loading: boolean;
}

function safeClientError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message.slice(0, 300)
    : "The accepted threat-overlay cache could not be read.";
}

function readPersistedProjectId(): string | null {
  try {
    const value = localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function payloadProjectId(payload: unknown): string | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const projectId = Reflect.get(payload, "projectId");
  return typeof projectId === "string" ? projectId : null;
}

function useThreatSnapshot(projectId: string | null): {
  state: SnapshotState;
  retry(): void;
} {
  const rpc = useRpc<typeof threatOverlayRpcContract>();
  const [requestRevision, setRequestRevision] = useState(0);
  const [state, setState] = useState<StoredSnapshotState>({
    projectId: null,
    data: null,
    loading: false,
    error: null,
    completedRequestRevision: -1,
  });
  const retry = useCallback(
    () => setRequestRevision((current) => current + 1),
    [],
  );
  useRealtime("tara:changed", (payload) => {
    if (projectId && payloadProjectId(payload) === projectId) retry();
  });

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void rpc
      .call("threatOverlaySnapshot", {
        projectId,
        projectVersionId: null,
      })
      .then((data) => {
        if (!active) return;
        setState({
          projectId,
          data,
          loading: false,
          error: null,
          completedRequestRevision: requestRevision,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState((current) => ({
          projectId,
          data: current.projectId === projectId ? current.data : null,
          loading: false,
          error: safeClientError(error),
          completedRequestRevision: requestRevision,
        }));
      });
    return () => {
      active = false;
    };
  }, [projectId, requestRevision, rpc]);
  const pending = Boolean(
    projectId &&
      (state.projectId !== projectId ||
        state.completedRequestRevision !== requestRevision),
  );
  return {
    state: projectId
      ? {
          projectId,
          data: state.projectId === projectId ? state.data : null,
          loading: pending,
          error:
            pending || state.projectId !== projectId ? null : state.error,
        }
      : { projectId: null, data: null, loading: false, error: null },
    retry,
  };
}

function DataflowThreatBadge({
  aggregate,
  sourceSlug,
  targetSlug,
}: {
  aggregate: ThreatAggregate;
  sourceSlug: string;
  targetSlug: string;
}): React.JSX.Element | null {
  const source = useInternalNode(sourceSlug);
  const target = useInternalNode(targetSlug);
  if (!source || !target || aggregate.total === 0) return null;
  const sourceWidth = source.measured.width ?? source.width ?? 0;
  const sourceHeight = source.measured.height ?? source.height ?? 0;
  const targetWidth = target.measured.width ?? target.width ?? 0;
  const targetHeight = target.measured.height ?? target.height ?? 0;
  const left =
    (source.internals.positionAbsolute.x + sourceWidth / 2 +
      target.internals.positionAbsolute.x +
      targetWidth / 2) /
    2;
  const top =
    (source.internals.positionAbsolute.y + sourceHeight / 2 +
      target.internals.positionAbsolute.y +
      targetHeight / 2) /
    2;
  return (
    <EdgeLabelRenderer>
      <div
        aria-label={`${aggregate.total} open threats target dataflow ${aggregate.targetSlug}`}
        className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-7 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 text-xs font-medium text-card-foreground shadow-sm"
        data-threat-edge={aggregate.targetSlug}
        style={{ left, top }}
      >
        <Icon aria-hidden="true" className="size-3.5" name="Target" />
        {aggregate.total}
      </div>
    </EdgeLabelRenderer>
  );
}

function ThreatCanvasMarkers({
  aggregates,
  labels,
}: {
  aggregates: readonly ThreatAggregate[];
  labels: Record<StrideSegment, string>;
}): React.JSX.Element {
  const architecture = useArchitectureSelection();
  return (
    <>
      {aggregates.map((aggregate) => {
        const node = architecture.nodesBySlug.get(aggregate.targetSlug);
        if (node) {
          return (
            <NodeToolbar
              isVisible
              key={aggregate.targetSlug}
              nodeId={aggregate.targetSlug}
              offset={6}
              position={Position.Bottom}
            >
              <StrideMicroBar aggregate={aggregate} labels={labels} />
            </NodeToolbar>
          );
        }
        const edge = architecture.edgesBySlug.get(aggregate.targetSlug);
        return edge ? (
          <DataflowThreatBadge
            aggregate={aggregate}
            key={aggregate.targetSlug}
            sourceSlug={edge.sourceSlug}
            targetSlug={edge.targetSlug}
          />
        ) : null;
      })}
    </>
  );
}

function loadingPanel(): React.JSX.Element {
  return (
    <div
      aria-label="Loading threat overlay"
      className="absolute bottom-3 left-3 right-3 z-20 h-56 overflow-hidden rounded-lg border border-border bg-card/95 p-3 text-card-foreground shadow-lg"
      role="status"
    >
      <div className="mb-3 h-5 w-64 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        {[0, 1, 2].map((row) => (
          <div className="h-12 animate-pulse rounded-md bg-muted" key={row} />
        ))}
      </div>
      <span className="sr-only">Loading accepted threats and STRIDE counts</span>
    </div>
  );
}

export function ProductSecurityThreatOverlay({
  projectId: explicitProjectId,
  focus = null,
  highlight = null,
}: ProductSecurityThreatOverlayProps = {}): React.JSX.Element {
  const { projectId: routeProjectId } = useBbContext();
  const [persistedProjectId] = useState(readPersistedProjectId);
  const projectId = explicitProjectId ?? routeProjectId ?? persistedProjectId;

  if (!projectId) {
    return (
      <div className="absolute bottom-3 left-3 right-3 z-20 rounded-lg border border-border bg-card/95 p-4 text-card-foreground shadow-lg">
        <p className="text-sm font-medium">Threat overlay needs a project</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose the Product Security project before reading accepted threats.
        </p>
      </div>
    );
  }

  return (
    <ConfiguredThreatOverlay
      focus={focus}
      highlight={highlight}
      projectId={projectId}
    />
  );
}

function ConfiguredThreatOverlay({
  projectId,
  focus,
  highlight,
}: {
  projectId: string;
  focus: string | null;
  highlight: string | null;
}): React.JSX.Element {
  const navigate = useBbNavigate();
  const architecture = useArchitectureSelection();
  const architectureEdgesBySlug = architecture.edgesBySlug;
  const architectureNodesBySlug = architecture.nodesBySlug;
  const architectureSelectedIds = architecture.selectedIds;
  const setArchitectureSelectedIds = architecture.setSelectedIds;
  const { fitView, setEdges, setNodes } = useReactFlow();
  const rpc = useRpc<typeof threatOverlayRpcContract>();
  const snapshot = useThreatSnapshot(projectId);
  const [selectionState, dispatchSelection] = useReducer(
    reduceThreatSelection,
    EMPTY_THREAT_SELECTION,
  );
  const [pathList, setPathList] = useState<PathListState>({
    threatSlug: null,
    items: [],
    total: 0,
    next: null,
    loading: false,
    error: null,
  });
  const [pathDetail, setPathDetail] = useState<PathDetailState>({
    routeSignature: null,
    result: null,
    loading: false,
  });
  const pathListRequestRef = useRef(0);
  const pathDetailRequestRef = useRef(0);
  const programmaticSelectionRef = useRef<string | null>(null);
  const programmaticSelectionTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const appliedDeepLinkRef = useRef<string | null>(null);
  const routeThreatSlug =
    highlight ??
    (typeof window === "undefined"
      ? null
      : threatSlugFromPathname(window.location.pathname));
  const threats = snapshot.state.data?.threats ?? EMPTY_THREATS;
  const aggregates = snapshot.state.data?.aggregates ?? EMPTY_AGGREGATES;
  const labels = snapshot.state.data?.methodology.labels;
  const selectedThreat = useMemo(
    () =>
      threats.find(
        (threat) => threat.slug === selectionState.selection.threatSlug,
      ) ?? null,
    [selectionState.selection.threatSlug, threats],
  );
  const resolvedPath = useMemo<ResolvedAttackPath | null>(() => {
    if (
      pathDetail.routeSignature !== selectionState.selection.routeSignature
    ) {
      return null;
    }
    const path = pathDetail.result?.path;
    if (!path) return null;
    return resolveAttackPath(
      path.routeSignature,
      path.threatSlug,
      path.steps,
      path.exploitability,
      path.viability,
      new Set(architectureNodesBySlug.keys()),
      [...architectureEdgesBySlug.values()].map((edge) => ({
        slug: edge.slug,
        sourceSlug: edge.sourceSlug,
        targetSlug: edge.targetSlug,
      })),
    );
  }, [
    architectureEdgesBySlug,
    architectureNodesBySlug,
    pathDetail.result,
    pathDetail.routeSignature,
    selectionState.selection.routeSignature,
  ]);

  useEffect(() => {
    if (!snapshot.state.data) return;
    dispatchSelection({
      type: "reconcile",
      threats: snapshot.state.data.threats,
      routeSignatures: new Set(pathList.items.map((path) => path.routeSignature)),
    });
  }, [pathList.items, snapshot.state.data]);

  useEffect(() => {
    if (!snapshot.state.data) return;
    const initialThreatSlug = routeThreatSlug;
    if (initialThreatSlug) {
      const marker = `${snapshot.state.data.revision}:${initialThreatSlug}`;
      if (
        appliedDeepLinkRef.current === marker &&
        selectionState.selection.threatSlug === initialThreatSlug
      ) {
        return;
      }
      const threat = snapshot.state.data.threats.find(
        (candidate) => candidate.slug === initialThreatSlug,
      );
      if (threat) {
        appliedDeepLinkRef.current = marker;
        programmaticSelectionRef.current = threatSelectionKey(
          threat.targetSlugs,
        );
        dispatchSelection({ type: "threat", threat });
      }
      return;
    }
    if (focus && appliedDeepLinkRef.current !== focus) {
      appliedDeepLinkRef.current = focus;
      dispatchSelection({ type: "graph", targetSlug: focus });
    }
  }, [
    focus,
    routeThreatSlug,
    selectionState.selection.threatSlug,
    snapshot.state.data,
  ]);

  const loadPaths = useCallback(
    (threatSlug: string, continuation: string | null, append: boolean) => {
      if (!projectId) return;
      const requestId = ++pathListRequestRef.current;
      setPathList((current) => ({
        threatSlug,
        items: current.threatSlug === threatSlug ? current.items : [],
        total: current.threatSlug === threatSlug ? current.total : 0,
        next: current.threatSlug === threatSlug ? current.next : null,
        loading: true,
        error: null,
      }));
      void rpc
        .call("threatOverlayPaths", {
          projectId,
          projectVersionId: null,
          threatSlug,
          pageSize: 50,
          continuation,
        })
        .then((page: PathPage) => {
          if (pathListRequestRef.current !== requestId) return;
          setPathList((current) => ({
            threatSlug,
            items:
              append && current.threatSlug === threatSlug
                ? [...current.items, ...page.items]
                : page.items,
            total: page.total,
            next: page.next,
            loading: false,
            error: null,
          }));
        })
        .catch((error: unknown) => {
          if (pathListRequestRef.current !== requestId) return;
          setPathList((current) => ({
            ...current,
            threatSlug,
            loading: false,
            error: safeClientError(error),
          }));
        });
    },
    [projectId, rpc],
  );

  useEffect(() => {
    const threatSlug = selectionState.selection.threatSlug;
    if (!threatSlug) {
      pathListRequestRef.current += 1;
      return;
    }
    loadPaths(threatSlug, null, false);
  }, [
    loadPaths,
    selectionState.selection.threatSlug,
    snapshot.state.data?.revision,
  ]);

  const loadPathDetail = useCallback(
    (routeSignature: string) => {
      if (!projectId) return;
      const requestId = ++pathDetailRequestRef.current;
      setPathDetail({ routeSignature, result: null, loading: true });
      void rpc
        .call("threatOverlayPath", {
          projectId,
          projectVersionId: null,
          routeSignature,
        })
        .then((result: PathResult) => {
          if (pathDetailRequestRef.current !== requestId) return;
          setPathDetail({ routeSignature, result, loading: false });
        })
        .catch((error: unknown) => {
          if (pathDetailRequestRef.current !== requestId) return;
          setPathDetail({
            routeSignature,
            result: {
              path: null,
              error: safeClientError(error),
              cache: {
                state: "empty",
                asOf: null,
                message: "Selected path detail is unavailable.",
              },
            },
            loading: false,
          });
        });
    },
    [projectId, rpc],
  );

  useEffect(() => {
    const routeSignature = selectionState.selection.routeSignature;
    if (!routeSignature) {
      pathDetailRequestRef.current += 1;
      return;
    }
    loadPathDetail(routeSignature);
  }, [
    loadPathDetail,
    selectionState.selection.routeSignature,
    snapshot.state.data?.revision,
  ]);

  const selectPath = useCallback(
    (routeSignature: string) => {
      programmaticSelectionRef.current = threatSelectionKey(
        selectedThreat?.targetSlugs ?? [],
      );
      dispatchSelection({
        type: "path",
        routeSignature,
        highlightedSlugs: selectedThreat?.targetSlugs ?? [],
      });
    },
    [selectedThreat?.targetSlugs],
  );

  useEffect(() => {
    if (!resolvedPath || !pathDetail.routeSignature) return;
    programmaticSelectionRef.current = threatSelectionKey(
      resolvedPath.highlightedSlugs,
    );
    dispatchSelection({
      type: "path",
      routeSignature: pathDetail.routeSignature,
      highlightedSlugs: resolvedPath.highlightedSlugs,
    });
  }, [pathDetail.routeSignature, resolvedPath]);

  const architectureSelectionKey = threatSelectionKey(
    architectureSelectedIds,
  );
  useEffect(() => {
    const expectedKey = programmaticSelectionRef.current;
    if (expectedKey !== null) {
      const isProgrammaticSnapshot = isProgrammaticSelectionSnapshot(
        expectedKey,
        architectureSelectedIds,
      );
      if (isProgrammaticSnapshot) {
        return;
      }
      programmaticSelectionRef.current = null;
    }
    const selectedId =
      architectureSelectedIds.length === 1
        ? architectureSelectedIds[0] ?? null
        : null;
    const isArchitectureTarget = Boolean(
      selectedId &&
        (architectureNodesBySlug.has(selectedId) ||
          architectureEdgesBySlug.has(selectedId)),
    );
    if (
      architectureSelectedIds.length === 0 &&
      (routeThreatSlug !== null || focus !== null)
    ) {
      return;
    }
    dispatchSelection({
      type: "graph",
      targetSlug: isArchitectureTarget ? selectedId : null,
    });
  }, [
    architectureEdgesBySlug,
    architectureNodesBySlug,
    architectureSelectedIds,
    architectureSelectionKey,
    focus,
    routeThreatSlug,
  ]);

  const highlightedKey = threatSelectionKey(
    selectionState.highlightedTargetSlugs,
  );
  useEffect(() => {
    const highlightedIds = new Set(selectionState.highlightedTargetSlugs);
    programmaticSelectionRef.current = highlightedKey;
    if (programmaticSelectionTimerRef.current !== null) {
      clearTimeout(programmaticSelectionTimerRef.current);
    }
    programmaticSelectionTimerRef.current = setTimeout(() => {
      if (programmaticSelectionRef.current === highlightedKey) {
        programmaticSelectionRef.current = null;
      }
      programmaticSelectionTimerRef.current = null;
    }, 250);
    setArchitectureSelectedIds(selectionState.highlightedTargetSlugs);
    setNodes((nodes) =>
      nodes.map((node) => ({
        ...node,
        selected: highlightedIds.has(node.id),
      })),
    );
    setEdges((edges) =>
      edges.map((edge) => ({
        ...edge,
        selected: highlightedIds.has(edge.id),
      })),
    );
    const fitNodeIds = selectionState.highlightedTargetSlugs.flatMap((slug) => {
      if (architectureNodesBySlug.has(slug)) return [slug];
      const edge = architectureEdgesBySlug.get(slug);
      return edge ? [edge.sourceSlug, edge.targetSlug] : [];
    });
    if (fitNodeIds.length > 0) {
      void fitView({
        nodes: [...new Set(fitNodeIds)].map((id) => ({ id })),
        duration: 180,
        padding: 0.4,
      });
    }
    const selectedThreatSlug = selectionState.selection.threatSlug;
    if (
      selectedThreatSlug &&
      (typeof window === "undefined" ||
        threatSlugFromPathname(window.location.pathname) !==
          selectedThreatSlug)
    ) {
      navigate.toPluginPanel("product-security", {
        subPath: threatFocusSubPath(selectedThreatSlug),
      });
    }
  }, [
    architectureEdgesBySlug,
    architectureNodesBySlug,
    fitView,
    highlightedKey,
    navigate,
    selectionState.selection.threatSlug,
    selectionState.highlightedTargetSlugs,
    setArchitectureSelectedIds,
    setEdges,
    setNodes,
  ]);

  useEffect(
    () => () => {
      if (programmaticSelectionTimerRef.current !== null) {
        clearTimeout(programmaticSelectionTimerRef.current);
      }
    },
    [],
  );

  const selectThreat = useCallback(
    (threat: ThreatSummary) => {
      programmaticSelectionRef.current = threatSelectionKey(
        threat.targetSlugs,
      );
      dispatchSelection({ type: "threat", threat });
      navigate.toPluginPanel("product-security", {
        subPath: threatFocusSubPath(threat.slug),
      });
    },
    [navigate],
  );
  const clearThreat = useCallback(() => {
    dispatchSelection({ type: "graph", targetSlug: null });
    navigate.toPluginPanel("product-security", { subPath: "tara" });
  }, [navigate]);
  const aggregatesMap = useMemo(
    () => aggregatesByTarget(aggregates),
    [aggregates],
  );
  const validAggregates = useMemo(
    () =>
      [...aggregatesMap.values()].filter(
        (aggregate) =>
          architectureNodesBySlug.has(aggregate.targetSlug) ||
          architectureEdgesBySlug.has(aggregate.targetSlug),
      ),
    [aggregatesMap, architectureEdgesBySlug, architectureNodesBySlug],
  );

  if (!snapshot.state.data && snapshot.state.loading) return loadingPanel();
  if (!snapshot.state.data) {
    return (
      <div
        className="absolute bottom-3 left-3 right-3 z-20 flex items-center gap-3 rounded-lg border border-destructive/40 bg-card/95 p-4 text-card-foreground shadow-lg"
        role="alert"
      >
        <Icon aria-hidden="true" className="size-5 text-destructive" name="AlertTriangle" />
        <div>
          <p className="text-sm font-medium">Threat overlay unavailable</p>
          <p className="text-xs text-muted-foreground">{snapshot.state.error}</p>
        </div>
        <button
          className="ml-auto rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={snapshot.retry}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {labels ? (
        <ThreatCanvasMarkers aggregates={validAggregates} labels={labels} />
      ) : null}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex h-64 min-h-0 overflow-hidden rounded-lg border border-border bg-card/95 text-card-foreground shadow-lg backdrop-blur-sm">
        {selectedThreat ? (
          <AttackPathOverlay
            error={
              selectionState.selection.routeSignature
                ? pathDetail.result?.error ?? pathList.error
                : pathList.error
            }
            loading={
              pathList.loading ||
              (selectionState.selection.routeSignature !== null &&
                pathDetail.loading)
            }
            next={pathList.next}
            onBack={clearThreat}
            onLoadMore={() => {
              if (pathList.threatSlug && pathList.next) {
                loadPaths(pathList.threatSlug, pathList.next, true);
              }
            }}
            onSelectPath={selectPath}
            paths={pathList.items}
            selectedPath={resolvedPath}
            selectedRouteSignature={selectionState.selection.routeSignature}
            threatLabel={selectedThreat.title}
            total={pathList.total}
          />
        ) : (
          <section className="flex min-w-0 flex-1 flex-col" aria-label="Threat overlay">
            <div className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-2">
              {labels ? (
                <ThreatLegend
                  configured={snapshot.state.data.methodology.configured}
                  labels={labels}
                />
              ) : null}
              <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                {snapshot.state.data.threats.length} open threats
              </span>
            </div>
            {snapshot.state.error ||
            snapshot.state.data.partialError ||
            snapshot.state.data.cache.state === "stale" ? (
              <div
                className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs text-foreground"
                role="status"
              >
                <Icon aria-hidden="true" className="size-3.5 text-destructive" name="AlertTriangle" />
                <span className="truncate">
                  {snapshot.state.error
                    ? "Refresh failed; accepted threats remain usable."
                    : snapshot.state.data.partialError ??
                      "Threat overlay is stale; accepted cache remains usable."}
                </span>
              </div>
            ) : null}
            {labels ? (
              <ThreatTable
                filterTargetSlug={selectionState.selection.targetSlug}
                labels={labels}
                onClearFilter={() =>
                  dispatchSelection({ type: "graph", targetSlug: null })
                }
                onSelectThreat={selectThreat}
                selectedThreatSlug={selectionState.selection.threatSlug}
                threats={threats}
              />
            ) : null}
          </section>
        )}
      </div>
    </>
  );
}
