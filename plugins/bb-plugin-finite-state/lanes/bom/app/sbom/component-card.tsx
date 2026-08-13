import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue, rpcContract } from "../../../../shared/contract.js";
import type { FindingRowView } from "./sbom-row.js";

export interface ComponentCardProps {
  id: string;
  mode?: "software" | "hardware";
}

interface BomScope {
  projectId: string;
  projectVersionId: string;
}

const BomScopeContext = createContext<BomScope | null>(null);

export function useBomScope(): BomScope | null {
  return useContext(BomScopeContext);
}

export function BomScopeProvider({
  projectId,
  projectVersionId,
  children,
}: BomScope & { children: React.ReactNode }): React.JSX.Element {
  const value = useMemo(
    () => ({ projectId, projectVersionId }),
    [projectId, projectVersionId],
  );
  return (
    <BomScopeContext.Provider value={value}>
      {children}
    </BomScopeContext.Provider>
  );
}

type ComponentResult = z.output<(typeof rpcContract)["bomComponentGet"]["output"]>;

function recordValue(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function stringValue(fields: Record<string, JsonValue>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

function booleanValue(fields: Record<string, JsonValue>, key: string): boolean {
  return fields[key] === true;
}

function stringList(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function findingsValue(value: JsonValue | undefined): FindingRowView[] {
  if (!Array.isArray(value)) return [];
  const findings: FindingRowView[] = [];
  for (const candidate of value) {
    const finding = recordValue(candidate);
    const stableKey = finding ? stringValue(finding, "stableKey") : null;
    if (!finding || !stableKey) continue;
    const epss = finding.epss;
    findings.push({
      stableKey,
      cve: stringValue(finding, "cve"),
      title: stringValue(finding, "title"),
      severity: stringValue(finding, "severity"),
      epss: typeof epss === "number" && Number.isFinite(epss) ? epss : null,
      kev: booleanValue(finding, "kev"),
      reachability: stringValue(finding, "reachability"),
      vexStatus: stringValue(finding, "vexStatus"),
      localChange: booleanValue(finding, "localChange"),
    });
  }
  return findings;
}

export interface ComponentDetailView {
  id: string;
  label: string;
  purl: string | null;
  cpe: string | null;
  group: string | null;
  version: string | null;
  license: string | null;
  supplier: string | null;
  source: string | null;
  files: string[];
  findings: FindingRowView[];
  localChange: boolean;
  upstreamStale: boolean;
  links: ComponentResult["links"];
  cache: ComponentResult["cache"];
}

export function toComponentDetail(result: ComponentResult): ComponentDetailView {
  return {
    id: result.key,
    label: result.label,
    purl: stringValue(result.fields, "purl"),
    cpe: stringValue(result.fields, "cpe"),
    group: stringValue(result.fields, "group"),
    version: stringValue(result.fields, "version"),
    license: stringValue(result.fields, "license"),
    supplier: stringValue(result.fields, "supplier"),
    source: stringValue(result.fields, "source"),
    files: stringList(result.fields.files),
    findings: findingsValue(result.fields.findings),
    localChange: booleanValue(result.fields, "localChange"),
    upstreamStale: booleanValue(result.fields, "upstreamStale"),
    links: result.links,
    cache: result.cache,
  };
}

interface ComponentDataState {
  status: "unconfigured" | "invalid" | "loading" | "ready" | "empty" | "error";
  data: ComponentDetailView | null;
  error: string | null;
  retry(): void;
}

export function useComponentData(
  id: string,
  mode: "software" | "hardware" = "software",
): ComponentDataState {
  const scope = useBomScope();
  const rpc = useRpc<typeof rpcContract>();
  const validId = id === id.trim() && id.length > 0 && id.length <= 512;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ComponentDataState["status"]>(
    scope ? "loading" : "unconfigured",
  );
  const [data, setData] = useState<ComponentDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!scope || !validId) return;
    let active = true;
    void rpc.call("bomComponentGet", {
      projectId: scope.projectId,
      projectVersionId: scope.projectVersionId,
      componentId: id,
      mode,
    }).then((result) => {
      if (!active) return;
      setData(toComponentDetail(result));
      setError(null);
      setStatus("ready");
    }).catch((cause: unknown) => {
      if (!active) return;
      const message = cause instanceof Error ? cause.message : "The component could not be loaded.";
      setError(message);
      setStatus(/NOT_FOUND/u.test(message) ? "empty" : "error");
    });
    return () => {
      active = false;
    };
  }, [attempt, id, mode, rpc, scope, validId]);

  if (!scope) return { status: "unconfigured", data: null, error: null, retry };
  if (!validId) return { status: "invalid", data: null, error: null, retry };
  if (data && data.id !== id) return { status: "loading", data: null, error: null, retry };
  return { status, data, error, retry };
}

function CardSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" aria-label="Loading component card">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

export function ComponentCard({ id, mode = "software" }: ComponentCardProps): React.JSX.Element {
  const state = useComponentData(id, mode);
  if (state.status === "loading") return <CardSkeleton />;
  if (state.status === "unconfigured") {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <h3 className="font-semibold">Choose a project version</h3>
        <p className="mt-1 text-muted-foreground">Component cards self-fetch after BOM scope is configured.</p>
      </div>
    );
  }
  if (state.status === "invalid") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm">
        <h3 className="font-semibold">Invalid component identity</h3>
        <p className="mt-1 text-muted-foreground">The untrusted ID was rejected before any request or rendering.</p>
      </div>
    );
  }
  if (state.status === "empty") {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm">
        <h3 className="font-semibold">Component not found</h3>
        <p className="mt-1 text-muted-foreground">Refresh the SBOM cache or verify this stable identity.</p>
        <Button className="mt-3" onClick={state.retry} size="sm" variant="outline">Retry</Button>
      </div>
    );
  }
  if (state.status === "error" || !state.data) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card p-4 text-sm">
        <Icon aria-hidden="true" className="size-5 text-destructive" name="AlertCircle" />
        <h3 className="mt-2 font-semibold">Component unavailable</h3>
        <p className="mt-1 text-muted-foreground">{state.error}</p>
        <Button className="mt-3" onClick={state.retry} size="sm" variant="outline">Retry</Button>
      </div>
    );
  }
  const component = state.data;
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card text-sm">
      {component.cache.state === "stale" ? (
        <div className="border-b border-destructive/40 bg-muted px-4 py-2 text-xs text-foreground">
          Stale cache · showing the last complete component record
        </div>
      ) : null}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{component.label}</h3>
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {component.purl ?? "No purl · fallback identity"}
            </p>
          </div>
          <Badge variant={component.findings.length > 0 ? "destructive" : "secondary"}>
            {component.findings.length} CVE{component.findings.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Version</dt><dd className="truncate font-mono">{component.version ?? "Unknown"}</dd>
          <dt className="text-muted-foreground">License</dt><dd className="truncate font-mono">{component.license ?? "Unknown"}</dd>
          <dt className="text-muted-foreground">Evidence paths</dt><dd className="font-mono">{component.files.length}</dd>
          <dt className="text-muted-foreground">Cross-links</dt><dd className="font-mono">{component.links.length}</dd>
        </dl>
      </div>
    </article>
  );
}
