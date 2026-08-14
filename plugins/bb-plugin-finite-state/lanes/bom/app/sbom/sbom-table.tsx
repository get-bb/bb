import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { useBbNavigate, useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { JsonValue } from "../../../../shared/contract.js";
import { bomAppRpcContract } from "../../rpc.js";
import type { SbomFiltersValue } from "./filters.js";
import { encodeComponentRouteKey } from "./routes.js";
import { SbomRow, type FindingRowView, type SbomRowView } from "./sbom-row.js";

interface CacheView {
  state: "fresh" | "stale" | "empty";
  asOf: string | null;
  message: string | null;
}
interface FindingDetailState {
  status: "loading" | "ready" | "error";
  findings: FindingRowView[];
  message: string | null;
}
type BomSoftwarePage = z.output<
  (typeof bomAppRpcContract)["bomSoftwareList"]["output"]
>;
type BomSoftwareItem = BomSoftwarePage["items"][number];

function recordValue(
  value: JsonValue | undefined,
): Record<string, JsonValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function realtimeProjectVersion(value: unknown): string | null {
  return typeof value === "object" &&
    value !== null &&
    "projectVersionId" in value &&
    typeof value.projectVersionId === "string"
    ? value.projectVersionId
    : null;
}

function stringValue(
  fields: Record<string, JsonValue>,
  key: string,
): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

function numberValue(fields: Record<string, JsonValue>, key: string): number {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(fields: Record<string, JsonValue>, key: string): boolean {
  return fields[key] === true;
}

function findingsValue(value: JsonValue | undefined): FindingRowView[] {
  if (!Array.isArray(value)) return [];
  const findings: FindingRowView[] = [];
  for (const candidate of value) {
    const finding = recordValue(candidate);
    if (!finding) continue;
    const stableKey = stringValue(finding, "stableKey");
    if (!stableKey) continue;
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

function reachabilityValue(
  value: JsonValue | undefined,
): SbomRowView["reachability"] {
  return value === "reachable" || value === "unreachable" || value === "mixed"
    ? value
    : "unknown";
}

function toRow(item: BomSoftwareItem): SbomRowView {
  const fields = item.fields;
  const vuln = recordValue(fields.vuln) ?? {};
  return {
    id: item.key,
    componentKey: item.key,
    identityLabel: item.label,
    purl: stringValue(fields, "purl"),
    severityCounts: {
      critical: numberValue(vuln, "critical"),
      high: numberValue(vuln, "high"),
      medium: numberValue(vuln, "medium"),
      low: numberValue(vuln, "low"),
    },
    kevCount: numberValue(vuln, "kev"),
    reachability: reachabilityValue(vuln.reachability),
    fileCount: numberValue(fields, "fileCount"),
    localChange: booleanValue(fields, "localChange"),
    linked: booleanValue(fields, "linked"),
    version: stringValue(fields, "version"),
    license: stringValue(fields, "license"),
    source: stringValue(fields, "source"),
    upstreamStale: booleanValue(fields, "upstreamStale"),
    findings: [],
  };
}

function rpcFilters(value: SbomFiltersValue): Record<string, JsonValue> {
  return {
    ...(value.search ? { search: value.search } : {}),
    ...(value.severity ? { minimumSeverity: value.severity } : {}),
    ...(value.kev !== "all" ? { kev: value.kev === "yes" } : {}),
    ...(value.reachability ? { reachability: value.reachability } : {}),
    ...(value.license ? { license: value.license } : {}),
    ...(value.source ? { source: value.source } : {}),
    ...(value.linked !== "all" ? { linked: value.linked === "yes" } : {}),
    ...(value.localChange !== "all"
      ? { localChange: value.localChange === "yes" }
      : {}),
    sort: value.sort,
    direction: value.direction,
  };
}

function TableSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-2 p-3" aria-label="Loading software inventory">
      {Array.from({ length: 9 }, (_, index) => (
        <div className="flex h-11 items-center gap-3" key={index}>
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export interface SbomTableProps {
  projectId: string;
  projectVersionId: string;
  filters: SbomFiltersValue;
  onOpen(componentKey: string): void;
}

export function SbomTable({
  projectId,
  projectVersionId,
  filters,
  onOpen,
}: SbomTableProps): React.JSX.Element {
  const rpc = useRpc<typeof bomAppRpcContract>();
  const navigate = useBbNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);
  const [rows, setRows] = useState<SbomRowView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [cache, setCache] = useState<CacheView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [findingDetails, setFindingDetails] = useState<
    Readonly<Record<string, FindingDetailState>>
  >({});
  const serializedFilters = useMemo(
    () => JSON.stringify(rpcFilters(filters)),
    [filters],
  );

  const readPage = useCallback(
    async (
      continuation: string | null,
      append: boolean,
      generation: number,
    ) => {
      const input = {
        projectId,
        projectVersionId,
        pageSize: 100,
        continuation,
        filters: rpcFilters(filters),
      };
      const page = await rpc.call("bomSoftwareList", input);
      if (generation !== requestGeneration.current) return;
      const nextRows = page.items.map((item) => toRow(item));
      setRows((current) => (append ? [...current, ...nextRows] : nextRows));
      setNext(page.next);
      setTotal(page.total);
      setCache(page.cache);
      setError(null);
      setPageError(null);
    },
    [filters, projectId, projectVersionId, rpc],
  );

  const refresh = useCallback(
    async (keepVisible = false) => {
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      if (!keepVisible) setLoading(true);
      try {
        await readPage(null, false, generation);
      } catch (cause) {
        if (generation !== requestGeneration.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The SBOM page could not be loaded.",
        );
      } finally {
        if (generation === requestGeneration.current) setLoading(false);
      }
    },
    [readPage],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      scrollRef.current?.scrollTo({ top: 0 });
      void refresh();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [projectId, projectVersionId, refresh, serializedFilters]);

  useRealtime("bom:changed", (payload) => {
    if (realtimeProjectVersion(payload) !== projectVersionId) return;
    void refresh(true);
  });

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    const generation = requestGeneration.current;
    try {
      await readPage(next, true, generation);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setPageError(
          cause instanceof Error
            ? cause.message
            : "The next page could not be loaded.",
        );
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, next, readPage]);

  const pullInventory = useCallback(async () => {
    if (pulling) return;
    setPulling(true);
    setPullError(null);
    try {
      await rpc.call("syncPull", {
        projectId,
        projectVersionId,
        kinds: ["sbomComponent"],
      });
      await refresh();
    } catch (cause) {
      setPullError(
        cause instanceof Error ? cause.message : "The SBOM pull failed.",
      );
    } finally {
      setPulling(false);
    }
  }, [projectId, projectVersionId, pulling, refresh, rpc]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (expanded.has(rows[index]?.id ?? "") ? 150 : 44),
    getItemKey: (index) => rows[index]?.id ?? index,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualItems.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastVirtualIndex < rows.length - 8 || !next || pageError) return;
    void loadMore();
  }, [lastVirtualIndex, loadMore, next, pageError, rows.length]);

  const loadFindings = useCallback(
    async (row: SbomRowView) => {
      setFindingDetails((current) => ({
        ...current,
        [row.id]: {
          status: "loading",
          findings: current[row.id]?.findings ?? [],
          message: null,
        },
      }));
      try {
        const detail = await rpc.call("bomComponentGet", {
          projectId,
          projectVersionId,
          mode: "software",
          componentId: row.componentKey,
        });
        setFindingDetails((current) => ({
          ...current,
          [row.id]: {
            status: "ready",
            findings: findingsValue(detail.fields.findings),
            message: null,
          },
        }));
      } catch (cause) {
        setFindingDetails((current) => ({
          ...current,
          [row.id]: {
            status: "error",
            findings: current[row.id]?.findings ?? [],
            message:
              cause instanceof Error
                ? cause.message
                : "Vulnerability details could not be loaded.",
          },
        }));
      }
    },
    [projectId, projectVersionId, rpc],
  );

  const toggleExpanded = useCallback(
    (id: string) => {
      const opening = !expanded.has(id);
      setExpanded((current) => {
        const nextExpanded = new Set(current);
        if (nextExpanded.has(id)) nextExpanded.delete(id);
        else nextExpanded.add(id);
        return nextExpanded;
      });
      if (!opening || findingDetails[id]?.status === "ready") return;
      const row = rows.find((candidate) => candidate.id === id);
      if (row) void loadFindings(row);
    },
    [expanded, findingDetails, loadFindings, rows],
  );
  const openFinding = useCallback(
    (stableKey: string) => {
      navigate.toPluginPanel("findings", {
        subPath: `f/${encodeComponentRouteKey(stableKey)}`,
      });
    },
    [navigate],
  );

  if (loading && rows.length === 0) return <TableSkeleton />;
  if (error && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-card p-5 text-center">
          <Icon
            aria-hidden="true"
            className="mx-auto size-6 text-destructive"
            name="AlertCircle"
          />
          <h3 className="mt-3 font-semibold">Software inventory unavailable</h3>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button
            className="mt-4"
            onClick={() => void refresh()}
            variant="outline"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-border bg-card p-5 text-center">
          <Icon
            aria-hidden="true"
            className="mx-auto size-6 text-muted-foreground"
            name="PackageReceive"
          />
          <h3 className="mt-3 font-semibold">No components in this view</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {cache?.state === "empty"
              ? "Pull this project version’s SBOM to load its components."
              : "Adjust the server-backed filters or choose another shipped view."}
          </p>
          {pullError ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {pullError}
            </p>
          ) : null}
          <Button
            className="mt-4"
            disabled={pulling}
            onClick={() =>
              cache?.state === "empty" ? void pullInventory() : void refresh()
            }
            variant="outline"
          >
            {cache?.state === "empty"
              ? pulling
                ? "Pulling SBOM…"
                : "Pull SBOM"
              : "Retry query"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {cache?.state === "stale" || error || pullError ? (
        <div
          className="flex items-center gap-2 border-b border-destructive/40 bg-muted px-3 py-2 text-sm"
          role={pullError ? "alert" : "status"}
        >
          <Icon
            aria-hidden="true"
            className="size-4 text-destructive"
            name="AlertTriangle"
          />
          <span className="min-w-0 flex-1 truncate">
            {pullError ??
              error ??
              cache?.message ??
              "Showing the last complete SBOM cache."}
          </span>
          {cache?.state === "stale" ? (
            <Button
              disabled={pulling}
              onClick={() => void pullInventory()}
              size="sm"
              variant="outline"
            >
              {pulling ? "Pulling…" : "Pull again"}
            </Button>
          ) : (
            <Button
              onClick={() => void refresh(true)}
              size="sm"
              variant="outline"
            >
              Retry query
            </Button>
          )}
        </div>
      ) : null}
      <div
        aria-label="Software bill of materials"
        aria-rowcount={total ?? -1}
        className="flex min-h-0 flex-1 flex-col"
        role="table"
      >
        <div role="rowgroup">
          <div
            className="grid h-9 shrink-0 grid-cols-12 items-center gap-2 border-b border-border bg-muted/60 px-2 text-xs font-medium text-muted-foreground"
            role="row"
          >
            <span className="col-span-3 pl-7" role="columnheader">
              Component
            </span>
            <span className="col-span-1" role="columnheader">
              Version
            </span>
            <span className="col-span-1" role="columnheader">
              License
            </span>
            <span className="col-span-3" role="columnheader">
              Severity
            </span>
            <span className="col-span-1 text-right" role="columnheader">
              KEV
            </span>
            <span className="col-span-1" role="columnheader">
              Reachability
            </span>
            <span className="col-span-1 text-right" role="columnheader">
              Files
            </span>
            <span className="col-span-1 text-right" role="columnheader">
              Links
            </span>
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto"
          ref={scrollRef}
          role="rowgroup"
        >
          <div
            className="relative w-full"
            role="presentation"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const detail = findingDetails[row.id];
              return (
                <div
                  data-index={virtualRow.index}
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  role="presentation"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <SbomRow
                    expanded={expanded.has(row.id)}
                    findingsError={detail?.message ?? null}
                    findingsLoading={detail?.status === "loading"}
                    onExpand={toggleExpanded}
                    onFinding={openFinding}
                    onOpen={onOpen}
                    onRetryFindings={() => void loadFindings(row)}
                    onSelect={setSelectedId}
                    row={{ ...row, findings: detail?.findings ?? [] }}
                    selected={selectedId === row.id}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-3 text-xs text-muted-foreground">
        <span>
          {rows.length.toLocaleString()} loaded
          {total === null ? "" : ` of ${total.toLocaleString()}`}
        </span>
        {loadingMore ? <span>Loading next page…</span> : null}
        {next && !pageError && !loadingMore ? (
          <Button
            className="ml-auto"
            onClick={() => void loadMore()}
            size="sm"
            variant="ghost"
          >
            Load next page
          </Button>
        ) : null}
        {pageError ? (
          <>
            <span className="min-w-0 flex-1 truncate text-destructive">
              Next page failed: {pageError}
            </span>
            <Button
              onClick={() => {
                setPageError(null);
                void loadMore();
              }}
              size="sm"
              variant="outline"
            >
              Retry page
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
