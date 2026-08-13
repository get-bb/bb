import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBbNavigate, useRealtime, useRpc } from "@bb/plugin-sdk/app";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { JsonValue, RpcContract } from "../../../shared/contract.js";

export type BenchTier = "tier0" | "tier1" | "tier2" | "tier3" | "tier4";
export type BenchRunStatus = "queued" | "running" | "completed" | "failed" | "timeout";

export interface BenchTimelineQuery {
  pvId?: string;
  tier?: BenchTier;
  status?: BenchRunStatus;
  trigger?: string;
  failingOnly?: boolean;
  cursor?: string;
  limit?: number;
}

export interface BenchRunListItem {
  id: string;
  projectVersionId: string | null;
  tier: string;
  kind: string;
  trigger: string;
  status: string;
  target: string | null;
  firmwareDigest: string | null;
  threadId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  verdict: string | null;
  signed: boolean | null;
}

interface RunTimelineProps {
  projectId: string;
  projectVersionId: string | null;
  selectedRunId?: string | null;
  onOpen(run: BenchRunListItem): void;
  onRunTier0(): void;
}

function text(fields: Record<string, JsonValue>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" ? value : null;
}

function number(fields: Record<string, JsonValue>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBool(fields: Record<string, JsonValue>, key: string): boolean | null {
  const value = fields[key];
  return typeof value === "boolean" ? value : null;
}

export function benchRunListItem(item: {
  key: string;
  projectVersionId: string | null;
  fields: Record<string, JsonValue>;
}): BenchRunListItem {
  const fields = item.fields;
  return {
    id: item.key,
    projectVersionId: item.projectVersionId,
    tier: text(fields, "tier") ?? "unknown tier",
    kind: text(fields, "kind") ?? "verification run",
    trigger: text(fields, "trigger") ?? "unknown trigger",
    status: text(fields, "status") ?? "unknown",
    target: text(fields, "target"),
    firmwareDigest: text(fields, "firmwareDigest"),
    threadId: text(fields, "threadId"),
    startedAt: text(fields, "startedAt"),
    finishedAt: text(fields, "finishedAt"),
    durationMs: number(fields, "durationMs"),
    verdict: text(fields, "verdict"),
    signed: optionalBool(fields, "signed") ?? optionalBool(fields, "signatureVerified"),
  };
}

function statusIcon(status: string): "CircleCheck" | "CircleX" | "Loading" | "Workflow" | "AlertTriangle" {
  if (status === "completed") return "CircleCheck";
  if (status === "failed" || status === "timeout") return "CircleX";
  if (status === "running") return "Loading";
  if (status === "queued") return "Workflow";
  return "AlertTriangle";
}

function duration(run: BenchRunListItem): string {
  let milliseconds = run.durationMs;
  if (milliseconds === null && run.startedAt && run.finishedAt) {
    milliseconds = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
  }
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function TimelineSkeleton(): React.JSX.Element {
  return (
    <div aria-label="Loading bench runs" className="space-y-2 p-3" role="status">
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton className="h-24 w-full" key={index} />
      ))}
    </div>
  );
}

function RunSignatureBadge({
  projectId,
  run,
}: {
  projectId: string;
  run: BenchRunListItem;
}): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const [fetchedSigned, setFetchedSigned] = useState<boolean | null>(null);
  useEffect(() => {
    if (run.signed !== null) return;
    let active = true;
    void rpc.call("benchRunGet", {
      projectId,
      projectVersionId: run.projectVersionId,
      runId: run.id,
    }).then((detail) => {
      if (!active) return;
      const attestations = detail.fields.attestations;
      const verified = Array.isArray(attestations) && attestations.some(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          value.verified === true,
      );
      setFetchedSigned(verified);
    }).catch(() => {
      if (active) setFetchedSigned(null);
    });
    return () => {
      active = false;
    };
  }, [projectId, rpc, run.id, run.projectVersionId, run.signed]);
  const signed = run.signed ?? fetchedSigned;
  return <Badge variant="outline">{signed === null ? "Signature unknown" : signed ? "Signed" : "Unsigned"}</Badge>;
}

export function RunTimeline({
  projectId,
  projectVersionId,
  selectedRunId,
  onOpen,
  onRunTier0,
}: RunTimelineProps): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestEpoch = useRef(0);
  const hasRuns = useRef(false);
  const [runs, setRuns] = useState<BenchRunListItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [trigger, setTrigger] = useState("");
  const [failingOnly, setFailingOnly] = useState(false);
  const [revision, setRevision] = useState(0);

  const load = useCallback(async (continuation: string | null, epoch: number) => {
    continuation === null ? setLoading(true) : setLoadingMore(true);
    try {
      const page = await rpc.call("benchRunsList", {
        projectId,
        projectVersionId,
        pageSize: 100,
        continuation,
      });
      if (requestEpoch.current !== epoch) return;
      const incoming = page.items.map(benchRunListItem);
      setRuns((current) => {
        if (continuation === null) {
          hasRuns.current = incoming.length > 0;
          return incoming;
        }
        const ids = new Set(current.map((run) => run.id));
        const combined = [...current, ...incoming.filter((run) => !ids.has(run.id))];
        hasRuns.current = combined.length > 0;
        return combined;
      });
      setNext(page.next);
      setTotal(page.total);
      setStale(page.cache.state === "stale");
      setError(page.cache.message);
    } catch (cause) {
      if (requestEpoch.current !== epoch) return;
      setError(cause instanceof Error ? cause.message : "Bench runs could not be loaded.");
      setStale(hasRuns.current);
    } finally {
      if (requestEpoch.current === epoch) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [projectId, projectVersionId, rpc]);

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    void load(null, epoch);
    return () => {
      if (requestEpoch.current === epoch) requestEpoch.current += 1;
    };
  }, [load, revision]);
  useRealtime("bench:changed", () => setRevision((value) => value + 1));

  const visible = useMemo(() => runs.filter((run) => {
    if (tier && run.tier !== tier) return false;
    if (status && run.status !== status) return false;
    if (trigger && run.trigger !== trigger) return false;
    if (failingOnly && run.status !== "failed" && run.status !== "timeout" && run.verdict !== "red") return false;
    return true;
  }), [failingOnly, runs, status, tier, trigger]);
  const triggers = useMemo(() => [...new Set(runs.map((run) => run.trigger))].sort(), [runs]);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 112,
    overscan: 6,
  });

  if (loading && runs.length === 0) return <TimelineSkeleton />;
  if (!loading && runs.length === 0 && error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <section className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <Icon className="mx-auto size-6 text-destructive" name="AlertCircle" />
          <h2 className="mt-3 text-lg font-semibold">Bench timeline unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-4" onClick={() => setRevision((value) => value + 1)} variant="outline">Retry</Button>
        </section>
      </div>
    );
  }
  if (!loading && runs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <section className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <Icon className="mx-auto size-6 text-muted-foreground" name="ChartColumn" />
          <h2 className="mt-3 text-lg font-semibold">No bench runs yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Start with a bounded static Tier 0 verification.</p>
          <Button className="mt-4" onClick={onRunTier0}><Icon name="Workflow" />Run Tier 0</Button>
        </section>
      </div>
    );
  }

  return (
    <section aria-label="Bench run timeline" className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card p-3">
        <select aria-label="Filter by tier" className="h-8 rounded-md border border-input bg-background px-2 text-xs" onChange={(event) => setTier(event.target.value)} value={tier}>
          <option value="">All tiers</option>
          {(["tier0", "tier1", "tier2", "tier3", "tier4"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by status" className="h-8 rounded-md border border-input bg-background px-2 text-xs" onChange={(event) => setStatus(event.target.value)} value={status}>
          <option value="">All statuses</option>
          {(["queued", "running", "completed", "failed", "timeout"] as const).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select aria-label="Filter by trigger" className="h-8 rounded-md border border-input bg-background px-2 text-xs" onChange={(event) => setTrigger(event.target.value)} value={trigger}>
          <option value="">All triggers</option>
          {triggers.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs font-medium">
          <input checked={failingOnly} className="size-4 accent-primary" onChange={(event) => setFailingOnly(event.target.checked)} type="checkbox" />
          Failing only
        </label>
        <span className="ml-auto text-xs text-muted-foreground">{visible.length} shown{total === null ? "" : ` · ${total} total`}</span>
      </div>
      {stale || error ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs" role="status">
          <Icon name="AlertTriangle" />
          <span>{error ?? "Showing cached bench history."}</span>
          <Button className="ml-auto h-7" onClick={() => setRevision((value) => value + 1)} size="sm" variant="outline">Retry</Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto" ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const run = visible[virtualRow.index];
            if (!run) return null;
            return (
              <article
                aria-label={`${run.tier} ${run.status} run ${run.id}`}
                className={`absolute left-0 top-0 w-full border-b border-border p-3 ${selectedRunId === run.id ? "bg-muted/60" : "bg-background hover:bg-muted/30"}`}
                data-bench-run-row
                key={run.id}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <div className="flex items-start gap-3">
                  <span aria-label={`Status: ${run.status}`} className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground" role="img"><Icon name={statusIcon(run.status)} /></span>
                  <button className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(run)} type="button">
                    <span className="flex flex-wrap items-center gap-2">
                      <strong className="font-mono text-sm">{run.id}</strong>
                      <Badge variant="outline">{run.tier}</Badge>
                      <Badge variant="secondary">{run.status}</Badge>
                      <RunSignatureBadge projectId={projectId} run={run} />
                    </span>
                    <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground lg:grid-cols-4">
                      <span>Kind <b className="text-foreground">{run.kind}</b></span>
                      <span>Trigger <b className="text-foreground">{run.trigger}</b></span>
                      <span>Duration <b className="text-foreground">{duration(run)}</b></span>
                      <span>Verdict <b className="text-foreground">{run.verdict ?? "Pending"}</b></span>
                      <span className="col-span-2 font-mono lg:col-span-4">Firmware {run.firmwareDigest?.slice(0, 12) ?? "unavailable"}</span>
                    </span>
                  </button>
                  {run.threadId ? (
                    <Button aria-label={`Open native thread for ${run.id}`} onClick={() => navigate.toThread(run.threadId!)} size="sm" variant="outline"><Icon name="BubbleChatQuestion" />Thread</Button>
                  ) : (
                    <Badge aria-label="Native run thread unavailable" variant="outline">Thread unavailable</Badge>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {next ? <div className="flex justify-center border-t border-border p-3"><Button disabled={loadingMore} onClick={() => void load(next, requestEpoch.current)} size="sm" variant="outline">{loadingMore ? "Loading…" : "Load older runs"}</Button></div> : null}
        {visible.length === 0 ? <p className="p-8 text-center text-sm text-muted-foreground">No runs match these filters.</p> : null}
      </div>
    </section>
  );
}
