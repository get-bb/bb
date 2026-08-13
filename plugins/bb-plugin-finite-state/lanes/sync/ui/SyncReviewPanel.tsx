import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { EntityKind } from "../../../lib/sync/registry.js";
import type {
  HumanApprovalCapability,
  rpcContract,
} from "../../../shared/contract.js";
import { REMOTE_CONNECTIONS_CHANGED_CHANNEL } from "../../remote/connection-state.js";
import { BlastRadiusFooter } from "./BlastRadiusFooter.js";
import type { ConflictChoice } from "./ConflictResolution.js";
import {
  isSyncRouteIdentifier,
  PendingChangesChip,
  syncScopeSubPath,
} from "./PendingChangesChip.js";
import { PlanGroup } from "./PlanGroup.js";
import {
  isEntityKind,
  planItemId,
  type PlanRowResolutionState,
  type SyncPlanItem,
  type SyncPlanOperation,
  type SyncPlanPage,
} from "./PlanRow.js";
import { PushResults, type SyncPushReport } from "./PushResults.js";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const SCOPE_STORAGE_KEY = "finite-state:sync-review-scope:v1";
const PUSH_PROGRESS_CHANNEL = "fs-sync-push";
const GROUP_ORDER = [
  "create",
  "update",
  "delete",
  "conflict",
  "orphan",
  "noop",
] as const satisfies readonly SyncPlanOperation[];
const PRODUCT_SECURITY_KINDS = [
  "component",
  "zone",
  "dataflow",
  "asset",
  "threat",
  "mitigation",
  "requirement",
  "reqCheckMap",
  "checkParams",
  "attackPath",
  "sbomLink",
] as const satisfies readonly EntityKind[];
const PLATFORM_KINDS: ReadonlySet<string> = new Set(["vexDecision"]);
const ASSURANCE_STUDIO_KINDS: ReadonlySet<string> = new Set(
  PRODUCT_SECURITY_KINDS,
);

type SyncStatus = z.output<(typeof rpcContract)["syncStatus"]["output"]>;
type Connections = z.output<
  (typeof rpcContract)["connectionsStatus"]["output"]
>;

export interface SyncScope {
  projectId: string;
  projectVersionId: string | null;
}

export type SyncSurfaceFilter =
  | EntityKind
  | "all"
  | "product-security"
  | "triage";

export interface SyncReviewRoute {
  scope: SyncScope | null;
  surface: SyncSurfaceFilter;
  planId: string | null;
  runId: string | null;
}

type ParsedRoute =
  | { valid: true; route: SyncReviewRoute }
  | { valid: false };

interface ReadyState {
  kind: "ready";
  plan: SyncPlanPage;
  status: SyncStatus;
  connections: Connections;
}

type ReviewState =
  | { kind: "loading" }
  | { kind: "unconfigured"; message: string | null }
  | { kind: "error" }
  | ReadyState;

function validIdentifier(value: string): boolean {
  return isSyncRouteIdentifier(value) && !CONTROL_CHARACTER.test(value);
}

function decodeRouteSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return validIdentifier(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function parseSurface(value: string): SyncSurfaceFilter | null {
  if (
    value === "all" ||
    value === "product-security" ||
    value === "triage"
  ) {
    return value;
  }
  return isEntityKind(value) ? value : null;
}

export function parseSyncReviewSubPath(subPath: string): ParsedRoute {
  if (subPath === "") {
    return {
      valid: true,
      route: { scope: null, surface: "all", planId: null, runId: null },
    };
  }
  const rawSegments = subPath.split("/");
  if (rawSegments.some((segment) => segment.length === 0)) {
    return { valid: false };
  }
  const decoded = rawSegments.map(decodeRouteSegment);
  if (decoded.some((segment) => segment === null)) return { valid: false };
  const segments = decoded.filter((segment): segment is string => segment !== null);
  if (segments.length === 1) {
    const surface = parseSurface(segments[0]!);
    return surface
      ? {
          valid: true,
          route: { scope: null, surface, planId: null, runId: null },
        }
      : { valid: false };
  }

  let index = 0;
  let scope: SyncScope | null = null;
  let surface: SyncSurfaceFilter = "all";
  let planId: string | null = null;
  let runId: string | null = null;

  if (segments[index] === "scope") {
    const projectId = segments[index + 1];
    const projectVersionId = segments[index + 2];
    if (!projectId || !projectVersionId) return { valid: false };
    scope = {
      projectId,
      projectVersionId:
        projectVersionId === "@project" ? null : projectVersionId,
    };
    index += 3;
  }

  while (index < segments.length) {
    const keyword = segments[index];
    const value = segments[index + 1];
    if (!value) return { valid: false };
    if (keyword === "surface" && surface === "all") {
      const parsed = parseSurface(value);
      if (!parsed) return { valid: false };
      surface = parsed;
    } else if (keyword === "plan" && planId === null && runId === null) {
      planId = value;
    } else if (keyword === "run" && runId === null && planId === null) {
      runId = value;
    } else {
      return { valid: false };
    }
    index += 2;
  }

  return { valid: true, route: { scope, surface, planId, runId } };
}

function routeKinds(surface: SyncSurfaceFilter): EntityKind[] | undefined {
  if (surface === "all") return undefined;
  if (surface === "product-security") return [...PRODUCT_SECURITY_KINDS];
  if (surface === "triage") return ["vexDecision"];
  return [surface];
}

function routeSurfaceLabel(surface: SyncSurfaceFilter): string {
  if (surface === "all") return "All authored surfaces";
  if (surface === "product-security") return "Product Security";
  if (surface === "triage") return "Findings and VEX";
  return surface;
}

function buildReviewSubPath(
  scope: SyncScope,
  route: Pick<SyncReviewRoute, "surface" | "planId" | "runId">,
): string {
  let subPath = syncScopeSubPath(
    { projectId: scope.projectId, pvId: scope.projectVersionId },
    route.surface === "all" || route.surface === "product-security" || route.surface === "triage"
      ? "all"
      : route.surface,
  );
  if (route.surface === "product-security" || route.surface === "triage") {
    subPath += `/surface/${route.surface}`;
  }
  if (route.planId) subPath += `/plan/${route.planId}`;
  if (route.runId) subPath += `/run/${route.runId}`;
  return subPath;
}

function readPersistedScope(): SyncScope | null {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    if (!("projectId" in value) || typeof value.projectId !== "string") {
      return null;
    }
    if (
      !("projectVersionId" in value) ||
      (value.projectVersionId !== null &&
        typeof value.projectVersionId !== "string")
    ) {
      return null;
    }
    if (
      !validIdentifier(value.projectId) ||
      (value.projectVersionId !== null &&
        !validIdentifier(value.projectVersionId))
    ) {
      return null;
    }
    return {
      projectId: value.projectId,
      projectVersionId: value.projectVersionId,
    };
  } catch {
    return null;
  }
}

function persistScope(scope: SyncScope): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // The selected scope remains valid for the current mount.
  }
}

function samePlan(left: SyncPlanPage, right: SyncPlanPage): boolean {
  return (
    left.planId === right.planId &&
    left.planSha256 === right.planSha256 &&
    left.baseStateSha256 === right.baseStateSha256 &&
    left.projectId === right.projectId &&
    left.projectVersionId === right.projectVersionId
  );
}

function isConfiguredConnection(
  state: Connections["platform"]["state"],
): boolean {
  return state === "configured" || state === "connected";
}

function planConnectionReady(
  connections: Connections,
  plan: SyncPlanPage,
  realtimeState: ReturnType<typeof useRealtimeConnectionState>,
): boolean {
  if (realtimeState !== "connected") return false;
  const changedKinds = new Set(
    plan.items
      .filter((item) => item.operation !== "noop")
      .map((item) => item.kind),
  );
  const needsPlatform = [...changedKinds].some((kind) =>
    PLATFORM_KINDS.has(kind),
  );
  const needsAssuranceStudio = [...changedKinds].some((kind) =>
    ASSURANCE_STUDIO_KINDS.has(kind),
  );
  return (
    (!needsPlatform || isConfiguredConnection(connections.platform.state)) &&
    (!needsAssuranceStudio ||
      isConfiguredConnection(connections.assuranceStudio.state))
  );
}

function ScopeToolbar({
  scope,
  surface,
  onApply,
  onSurfaceChange,
}: {
  scope: SyncScope | null;
  surface: SyncSurfaceFilter;
  onApply(scope: SyncScope): void;
  onSurfaceChange(surface: SyncSurfaceFilter): void;
}): React.JSX.Element {
  const [projectId, setProjectId] = useState(scope?.projectId ?? "");
  const [projectVersionId, setProjectVersionId] = useState(
    scope?.projectVersionId ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-border bg-card px-3 py-2">
      <label className="min-w-48 flex-1 text-xs font-medium text-muted-foreground">
        Platform project ID
        <Input
          aria-invalid={error ? true : undefined}
          className="mt-1 h-8 font-mono text-xs"
          onChange={(event) => {
            setProjectId(event.target.value);
            setError(null);
          }}
          placeholder="project-id"
          value={projectId}
        />
      </label>
      <label className="min-w-48 flex-1 text-xs font-medium text-muted-foreground">
        Platform version ID · optional
        <Input
          className="mt-1 h-8 font-mono text-xs"
          onChange={(event) => {
            setProjectVersionId(event.target.value);
            setError(null);
          }}
          placeholder="Blank for project-level scope"
          value={projectVersionId}
        />
      </label>
      <label className="min-w-44 text-xs font-medium text-muted-foreground">
        Surface
        <select
          className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => {
            const parsed = parseSurface(event.target.value);
            if (parsed) onSurfaceChange(parsed);
          }}
          value={surface}
        >
          <option value="all">All authored surfaces</option>
          <option value="product-security">Product Security</option>
          <option value="triage">Findings and VEX</option>
          <option value="requirement">Requirements only</option>
          <option value="threat">Threats only</option>
          <option value="vexDecision">VEX decisions only</option>
          <option value="hbomPart">Hardware parts only</option>
        </select>
      </label>
      <Button
        onClick={() => {
          const nextProjectId = projectId.trim();
          const nextProjectVersionId = projectVersionId.trim();
          if (
            !validIdentifier(nextProjectId) ||
            (nextProjectVersionId.length > 0 &&
              !validIdentifier(nextProjectVersionId))
          ) {
            setError(
              "Use letters, numbers, periods, colons, underscores, or hyphens for Platform identifiers.",
            );
            return;
          }
          onApply({
            projectId: nextProjectId,
            projectVersionId:
              nextProjectVersionId.length > 0 ? nextProjectVersionId : null,
          });
        }}
        size="sm"
        variant="outline"
      >
        Apply scope
      </Button>
      {error ? (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LoadingState(): React.JSX.Element {
  return (
    <div aria-label="Loading Sync review plan" className="space-y-4 p-4" role="status">
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton className="h-14 w-full" key={index} />
      ))}
      <span className="sr-only">Loading current Sync status and plan</span>
    </div>
  );
}

function UnconfiguredState({
  message,
}: {
  message: string | null;
}): React.JSX.Element {
  return (
    <div className="flex min-h-80 items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <Icon className="size-6 text-muted-foreground" name="ElectricPlugs" />
        <h2 className="mt-4 text-lg font-semibold">Connect Finite State Platform</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {message ??
            "Configure the Platform URL and API token before loading a review plan."}
        </p>
        <Button asChild className="mt-5">
          <a href="/settings/plugins/finite-state">
            <Icon aria-hidden="true" name="Settings" />
            Open connection settings
          </a>
        </Button>
      </section>
    </div>
  );
}

function MissingScopeState(): React.JSX.Element {
  return (
    <div className="flex min-h-80 items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <Icon className="size-6 text-muted-foreground" name="Target" />
        <h2 className="mt-4 text-lg font-semibold">Choose a Platform scope</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Enter the Finite State Platform project ID and optional version ID.
          The bb project ID is intentionally not sent to Platform because the
          two systems use different identity spaces.
        </p>
      </section>
    </div>
  );
}

function ProjectScopeGuidanceState({
  surface,
}: {
  surface: SyncSurfaceFilter;
}): React.JSX.Element {
  const includesVexDecisions =
    surface === "all" || surface === "triage" || surface === "vexDecision";
  return (
    <div className="flex min-h-80 items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm">
        <Icon className="size-6 text-muted-foreground" name="Info" />
        <h2 className="mt-4 text-lg font-semibold">Choose a project version</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {includesVexDecisions
            ? "VEX decisions require a Platform project version. Enter a version ID above and apply the scope to review this surface."
            : "This review surface is not available at project level in the current web panel. Enter a Platform version ID above and apply the scope."}
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          No status or plan request was sent for this project-level route.
        </p>
      </section>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry(): void }): React.JSX.Element {
  return (
    <div className="flex min-h-80 items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-destructive/40 bg-card p-6 shadow-sm">
        <Icon className="size-6 text-destructive" name="AlertCircle" />
        <h2 className="mt-4 text-lg font-semibold">Sync review unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The authoritative status or plan could not be loaded. No remote write
          was attempted, and the URL was not used as plan data.
        </p>
        <Button className="mt-5" onClick={onRetry} variant="outline">
          <Icon aria-hidden="true" name="RotateCcw" />
          Retry current scope
        </Button>
      </section>
    </div>
  );
}

function BadRouteState({ onReset }: { onReset(): void }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-lg rounded-lg border border-destructive/40 bg-card p-6 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-wide text-destructive">
          BAD_SYNC_ROUTE
        </p>
        <h2 className="mt-2 text-lg font-semibold">This Sync route is invalid</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Scope, surface, plan, and run identifiers must use bounded canonical
          route segments. No RPC request was sent.
        </p>
        <Button className="mt-5" onClick={onReset} variant="outline">
          Return to Sync review
        </Button>
      </section>
    </div>
  );
}

function EmptyState({ onRetry }: { onRetry(): void }): React.JSX.Element {
  return (
    <div className="flex min-h-80 items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-success/40 bg-success/10 text-success">
          <Icon aria-hidden="true" name="CircleCheck" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">No local changes</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This scope has no authored changes to review. Edit a supported domain
          artifact or run `bb finite-state status`, then refresh.
        </p>
        <Button className="mt-5" onClick={onRetry} variant="outline">
          <Icon aria-hidden="true" name="RotateCcw" />
          Refresh plan
        </Button>
      </section>
    </div>
  );
}

export interface SyncReviewPanelProps extends PluginNavPanelProps {
  /** Test/integration seam only. Production cannot mint this in v1. */
  humanApprovalCapability?: HumanApprovalCapability | null;
}

export function SyncReviewPanel({
  subPath,
  humanApprovalCapability = null,
}: SyncReviewPanelProps): React.JSX.Element {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const realtimeState = useRealtimeConnectionState();
  const parsedRoute = useMemo(() => parseSyncReviewSubPath(subPath), [subPath]);
  const route = parsedRoute.valid ? parsedRoute.route : null;
  const [selectedScope, setSelectedScope] = useState<SyncScope | null>(() =>
    readPersistedScope(),
  );
  const activeScope = route?.scope ?? selectedScope;
  const surface = route?.surface ?? "all";
  const kinds = useMemo(() => routeKinds(surface), [surface]);
  const [state, setState] = useState<ReviewState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [confirmationChecked, setConfirmationChecked] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushReport, setPushReport] = useState<SyncPushReport | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [resolutionState, setResolutionState] = useState<
    Readonly<Record<string, PlanRowResolutionState>>
  >({});
  const [progressAnnouncement, setProgressAnnouncement] = useState("");
  const requestGeneration = useRef(0);
  const realtimeDebounce = useRef<number | null>(null);
  const connectedOnce = useRef(false);

  useEffect(() => {
    if (!route?.scope) return;
    setSelectedScope(route.scope);
    persistScope(route.scope);
  }, [route?.scope]);

  const loadPlan = useCallback(async (): Promise<SyncPlanPage> => {
    if (!activeScope) throw new Error("SYNC_SCOPE_REQUIRED");
    const baseInput = {
      projectId: activeScope.projectId,
      projectVersionId: activeScope.projectVersionId,
      pageSize: 200,
      ...(kinds ? { kinds } : {}),
    };
    const first = await rpc.call("syncPlan", {
      ...baseInput,
      continuation: null,
    });
    const items: SyncPlanItem[] = [...first.items];
    let continuation = first.next;
    let pageCount = 1;
    while (continuation !== null) {
      if (pageCount >= 100) throw new Error("SYNC_PLAN_PAGE_LIMIT");
      const next = await rpc.call("syncPlan", {
        ...baseInput,
        continuation,
      });
      if (!samePlan(first, next)) throw new Error("SYNC_PLAN_CHANGED_DURING_READ");
      items.push(...next.items);
      continuation = next.next;
      pageCount += 1;
    }
    return {
      ...first,
      items,
      next: null,
      total: first.total ?? items.length,
    };
  }, [activeScope, kinds, rpc]);

  const refresh = useCallback(
    async (keepVisible = false) => {
      if (!activeScope || activeScope.projectVersionId === null || !route) return;
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      if (keepVisible) setRefreshing(true);
      else setState({ kind: "loading" });
      const statusInput = {
        projectId: activeScope.projectId,
        projectVersionId: activeScope.projectVersionId,
        ...(kinds ? { kinds } : {}),
      };
      const [connectionsResult, statusResult, planResult] =
        await Promise.allSettled([
          rpc.call("connectionsStatus", null),
          rpc.call("syncStatus", statusInput),
          loadPlan(),
        ]);
      if (generation !== requestGeneration.current) return;
      setRefreshing(false);
      setProgressAnnouncement("");
      if (
        connectionsResult.status === "fulfilled" &&
        connectionsResult.value.platform.state === "needs-configuration"
      ) {
        setState({
          kind: "unconfigured",
          message: connectionsResult.value.platform.message,
        });
        return;
      }
      if (
        connectionsResult.status !== "fulfilled" ||
        statusResult.status !== "fulfilled" ||
        planResult.status !== "fulfilled"
      ) {
        setState({ kind: "error" });
        return;
      }
      if (route.planId && route.planId !== planResult.value.planId) {
        setState({ kind: "error" });
        return;
      }
      setState({
        kind: "ready",
        connections: connectionsResult.value,
        status: statusResult.value,
        plan: planResult.value,
      });
      setConfirmationChecked(false);
    },
    [activeScope, kinds, loadPlan, route, rpc],
  );

  useEffect(() => {
    if (
      !parsedRoute.valid ||
      !activeScope ||
      activeScope.projectVersionId === null
    ) {
      return;
    }
    void refresh(false);
  }, [activeScope, parsedRoute.valid, refresh]);

  const scheduleAuthoritativeRefresh = useCallback(() => {
    if (realtimeDebounce.current !== null) {
      window.clearTimeout(realtimeDebounce.current);
    }
    setProgressAnnouncement(
      "Sync activity detected. Refreshing authoritative status and plan.",
    );
    realtimeDebounce.current = window.setTimeout(() => {
      realtimeDebounce.current = null;
      void refresh(true);
    }, 100);
  }, [refresh]);

  useRealtime(PUSH_PROGRESS_CHANNEL, () => {
    scheduleAuthoritativeRefresh();
  });
  useRealtime(REMOTE_CONNECTIONS_CHANGED_CHANNEL, () => {
    scheduleAuthoritativeRefresh();
  });
  useEffect(
    () => () => {
      if (realtimeDebounce.current !== null) {
        window.clearTimeout(realtimeDebounce.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (realtimeState !== "connected") return;
    if (connectedOnce.current) scheduleAuthoritativeRefresh();
    connectedOnce.current = true;
  }, [realtimeState, scheduleAuthoritativeRefresh]);

  const resolveConflict = useCallback(
    async (
      item: SyncPlanItem,
      field: string,
      resolution: ConflictChoice,
    ) => {
      if (!humanApprovalCapability || state.kind !== "ready") return;
      const id = planItemId(item);
      setResolutionState((current) => ({
        ...current,
        [id]: { submittingField: field, errorField: null, error: null },
      }));
      try {
        await rpc.call("syncConflictResolve", {
          projectId: state.plan.projectId,
          projectVersionId: state.plan.projectVersionId,
          planId: state.plan.planId,
          expectedPlanSha256: state.plan.planSha256,
          expectedBaseStateSha256: state.plan.baseStateSha256,
          pageSize: 200,
          continuation: null,
          humanApprovalCapability,
          kind: item.kind,
          key: item.key,
          field,
          expectedBaseContentHash: item.expectedBaseContentHash,
          resolution,
        });
        setResolutionState((current) => ({
          ...current,
          [id]: { submittingField: null, errorField: null, error: null },
        }));
      } catch {
        setResolutionState((current) => ({
          ...current,
          [id]: {
            submittingField: null,
            errorField: field,
            error: "The plan fence changed or this decision could not be applied. The current plan was refetched.",
          },
        }));
      }
      await refresh(true);
    },
    [humanApprovalCapability, refresh, rpc, state],
  );

  const push = useCallback(async () => {
    if (!humanApprovalCapability || state.kind !== "ready") return;
    setPushing(true);
    setPushError(null);
    try {
      const report = await rpc.call("syncPush", {
        projectId: state.plan.projectId,
        projectVersionId: state.plan.projectVersionId,
        planId: state.plan.planId,
        expectedPlanSha256: state.plan.planSha256,
        expectedBaseStateSha256: state.plan.baseStateSha256,
        pageSize: 200,
        continuation: null,
        humanApprovalCapability,
      });
      setPushReport(report);
      navigate.toPluginPanel("sync", {
        subPath: buildReviewSubPath(
          {
            projectId: state.plan.projectId,
            projectVersionId: state.plan.projectVersionId,
          },
          { surface, planId: null, runId: report.runId },
        ),
      });
      await refresh(true);
    } catch {
      setPushError(
        "Push was not accepted. No whole-run success was inferred; refresh the fenced plan before retrying.",
      );
    } finally {
      setPushing(false);
    }
  }, [humanApprovalCapability, navigate, refresh, rpc, state, surface]);

  const retryPush = useCallback(
    async (keys: string[]) => {
      if (
        !humanApprovalCapability ||
        !activeScope ||
        !pushReport ||
        keys.length === 0
      ) {
        return;
      }
      setRetrying(true);
      setRetryError(null);
      try {
        const report = await rpc.call("syncPushRetry", {
          projectId: activeScope.projectId,
          projectVersionId: activeScope.projectVersionId,
          planId: pushReport.planId,
          expectedPlanSha256: pushReport.planSha256,
          expectedBaseStateSha256: pushReport.baseStateSha256,
          pageSize: 200,
          continuation: null,
          humanApprovalCapability,
          runId: pushReport.runId,
          keys,
        });
        setPushReport(report);
        await refresh(true);
      } catch {
        setRetryError(
          "Eligible failures were not retried. Refresh the fenced plan and inspect each item result.",
        );
      } finally {
        setRetrying(false);
      }
    },
    [activeScope, humanApprovalCapability, pushReport, refresh, rpc],
  );

  if (!parsedRoute.valid) {
    return (
      <BadRouteState
        onReset={() =>
          navigate.toPluginPanel("sync", { subPath: "", replace: true })
        }
      />
    );
  }

  const changeCount =
    state.kind === "ready"
      ? state.plan.items.filter((item) => item.operation !== "noop").length
      : 0;
  const connectionReady =
    state.kind === "ready"
      ? planConnectionReady(state.connections, state.plan, realtimeState)
      : false;

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ScopeToolbar
        key={`${activeScope?.projectId ?? "none"}\0${activeScope?.projectVersionId ?? "@project"}`}
        onApply={(scope) => {
          setSelectedScope(scope);
          persistScope(scope);
          navigate.toPluginPanel("sync", {
            subPath: buildReviewSubPath(scope, {
              surface,
              planId: route?.planId ?? null,
              runId: route?.runId ?? null,
            }),
          });
        }}
        onSurfaceChange={(nextSurface) => {
          if (!activeScope) return;
          navigate.toPluginPanel("sync", {
            subPath: buildReviewSubPath(activeScope, {
              surface: nextSurface,
              planId: null,
              runId: null,
            }),
          });
        }}
        scope={activeScope}
        surface={surface}
      />

      {!activeScope ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <MissingScopeState />
        </div>
      ) : activeScope.projectVersionId === null ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <ProjectScopeGuidanceState surface={surface} />
        </div>
      ) : state.kind === "loading" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <LoadingState />
        </div>
      ) : state.kind === "unconfigured" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <UnconfiguredState message={state.message} />
        </div>
      ) : state.kind === "error" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <ErrorState onRetry={() => void refresh(false)} />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="border-b border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
                    PLAN {state.plan.planId}
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    {routeSurfaceLabel(surface)} · {changeCount.toLocaleString()} proposed {changeCount === 1 ? "change" : "changes"}
                  </p>
                </div>
                <PendingChangesChip
                  scope={{
                    projectId: activeScope.projectId,
                    pvId: activeScope.projectVersionId,
                  }}
                  surface={
                    surface === "all" || surface === "product-security" || surface === "triage"
                      ? "all"
                      : surface
                  }
                />
                <Button
                  disabled={refreshing}
                  onClick={() => void refresh(true)}
                  size="sm"
                  variant="outline"
                >
                  <Icon
                    aria-hidden="true"
                    className={refreshing ? "animate-spin" : undefined}
                    name="RotateCcw"
                  />
                  Refresh
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline">{state.status.local.length} local</Badge>
                <Badge variant={state.status.conflicts.length > 0 ? "destructive" : "outline"}>
                  {state.status.conflicts.length} conflicts
                </Badge>
                <Badge variant="outline">{state.status.upstream.length} upstream</Badge>
                <Badge variant="outline">{state.status.orphans.length} orphans</Badge>
              </div>
            </div>

            {state.plan.staleness.degraded || state.plan.cache.state !== "fresh" ? (
              <Alert className="m-3">
                <Icon aria-hidden="true" name="AlertTriangle" />
                <AlertTitle>View-only degraded plan</AlertTitle>
                <AlertDescription>
                  The browser RPC cannot observe authored worktree files, or
                  its accepted cache is stale. The semantic plan remains
                  inspectable, but its fence is insufficient for push.
                </AlertDescription>
              </Alert>
            ) : null}
            {realtimeState !== "connected" ? (
              <Alert className="m-3">
                <Icon aria-hidden="true" name="AlertCircle" />
                <AlertTitle>Offline view</AlertTitle>
                <AlertDescription>
                  The last loaded plan remains viewable. Push stays disabled
                  until the realtime connection and required services recover.
                </AlertDescription>
              </Alert>
            ) : null}
            {route?.runId && pushReport?.runId !== route.runId ? (
              <Alert className="m-3">
                <Icon aria-hidden="true" name="Info" />
                <AlertTitle>Run result not retained in this view</AlertTitle>
                <AlertDescription>
                  Per-item results are authoritative only when returned by the
                  human push RPC. The current plan was refetched instead of
                  reconstructing a result from the URL.
                </AlertDescription>
              </Alert>
            ) : null}
            {pushError ? (
              <Alert className="m-3" variant="destructive">
                <Icon aria-hidden="true" name="AlertCircle" />
                <AlertTitle>Push unavailable</AlertTitle>
                <AlertDescription>{pushError}</AlertDescription>
              </Alert>
            ) : null}
            {pushReport && (!route?.runId || route.runId === pushReport.runId) ? (
              <PushResults
                authorizationAvailable={humanApprovalCapability !== null}
                onRetry={retryPush}
                report={pushReport}
                retryError={retryError}
                retrying={retrying}
              />
            ) : null}

            {changeCount === 0 ? (
              <EmptyState onRetry={() => void refresh(false)} />
            ) : (
              <div className="border-t border-border">
                {GROUP_ORDER.map((operation) => (
                  <PlanGroup
                    authorizationAvailable={humanApprovalCapability !== null}
                    items={state.plan.items.filter(
                      (item) => item.operation === operation,
                    )}
                    key={operation}
                    onResolve={resolveConflict}
                    operation={operation}
                    resolutionState={resolutionState}
                  />
                ))}
              </div>
            )}
          </div>

          <BlastRadiusFooter
            authorizationAvailable={humanApprovalCapability !== null}
            confirmationChecked={confirmationChecked}
            connectionReady={connectionReady}
            inFlight={pushing}
            loading={refreshing}
            onConfirmationChange={setConfirmationChecked}
            onPush={() => void push()}
            plan={state.plan}
          />
        </>
      )}
      <div aria-live="polite" className="sr-only">
        {progressAnnouncement}
      </div>
    </section>
  );
}
