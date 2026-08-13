import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { z } from "zod";
import type { RpcContract } from "../../../../shared/contract.js";
import { requirementCardModelSchema } from "../cards/schema.js";
import { FilterBar } from "./FilterBar.js";
import {
  parseTraceabilityDetail,
  traceabilityRpcRequest,
  traceabilitySubPath,
  type RequirementFilters,
} from "./filters.js";
import type { RequirementFacets, TraceabilityListFields } from "./query.js";
import { RequirementDetail } from "./RequirementDetail.js";
import { TraceabilityRail } from "./TraceabilityRail.js";
import type { RequirementTraceModel } from "./resolvers.js";

const facetCountSchema = z.object({ value: z.string(), count: z.number().int().nonnegative() }).strict();
const facetsSchema = z.object({
  pattern: z.array(facetCountSchema),
  reqType: z.array(facetCountSchema),
  priority: z.array(facetCountSchema),
  evidenceState: z.array(facetCountSchema),
  tier: z.array(facetCountSchema),
  stale: z.number().int().nonnegative(),
  localOnly: z.number().int().nonnegative(),
}).strict();
const traceNodeSchema = z.object({
  kind: z.enum(["threat", "requirement", "clause", "commit", "check", "run", "attestation"]),
  id: z.string(),
  label: z.string(),
  ready: z.boolean(),
  relation: z.string(),
  provenance: z.object({ source: z.string(), at: z.string().optional() }).strict().optional(),
  error: z.string().optional(),
  navigation: z.object({ subPath: z.string(), label: z.string() }).strict().optional(),
}).strict();
const traceSchema = z.object({
  card: requirementCardModelSchema,
  rail: z.object({
    requirementId: z.string(),
    nodes: z.array(traceNodeSchema),
    gaps: z.array(z.object({ from: z.string(), to: z.string(), reason: z.string() }).strict()),
  }).strict(),
  evidence: z.array(z.object({
    resultId: z.string(), checkId: z.string().nullable(), runId: z.string().nullable(),
    tier: z.string(), status: z.string(), summary: z.string().nullable(), executedAt: z.string().nullable(),
  }).strict()),
}).strict();
const fieldsSchema = z.object({
  card: requirementCardModelSchema,
  facets: facetsSchema,
  trace: traceSchema.nullable(),
}).strict();

interface TraceListItem {
  fields: TraceabilityListFields;
  projectVersionId: string | null;
}

type ViewState = "loading" | "ready" | "error";

function parseFields(value: unknown): TraceabilityListFields {
  return fieldsSchema.parse(value);
}

function CenteredState({
  icon,
  title,
  detail,
  action,
}: {
  icon: "AlertTriangle" | "Search" | "Spinner";
  title: string;
  detail: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center text-card-foreground shadow-xs">
        <Icon aria-hidden="true" className={icon === "Spinner" ? "mx-auto size-6 animate-spin text-primary" : "mx-auto size-6 text-muted-foreground"} name={icon} />
        <h1 className="mt-3 text-base font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function RequirementTraceList({
  items,
  total,
  facets,
  filters,
  state,
  message,
  next,
  onFilters,
  onOpen,
  onRetry,
}: {
  items: readonly TraceListItem[];
  total: number | null;
  facets?: RequirementFacets;
  filters: RequirementFilters;
  state: ViewState;
  message: string | null;
  next: string | null;
  onFilters(filters: RequirementFilters): void;
  onOpen(id: string): void;
  onRetry(): void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 154,
    getScrollElement: () => scrollRef.current,
    initialRect: { width: 960, height: 720 },
    overscan: 4,
  });
  if (state === "loading" && items.length === 0) {
    return <CenteredState detail="Querying the bounded local requirement index and evidence cache." icon="Spinner" title="Loading traceability" />;
  }
  if (state === "error" && items.length === 0) {
    return <CenteredState action={<button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted" onClick={onRetry} type="button">Retry indexed read</button>} detail={message ?? "Traceability could not be loaded."} icon="AlertTriangle" title="Traceability unavailable" />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <FilterBar facets={facets} filters={filters} onChange={onFilters} total={total} />
      {message ? <div className="border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs text-muted-foreground" role="status">{message}</div> : null}
      {state === "ready" && items.length === 0 ? (
        <CenteredState detail="No indexed requirement satisfies every active filter. Clear one or inspect the filter counts." icon="Search" title="No matching requirements" />
      ) : (
        <div aria-busy={state === "loading"} aria-label="Traceable requirements" className="min-h-0 flex-1 overflow-auto p-4" ref={scrollRef} role="feed">
          <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((row) => {
              const item = items[row.index];
              if (!item) return null;
              const card = item.fields.card;
              return (
                <div className="absolute left-0 top-0 w-full pb-3" data-trace-result-row key={card.requirement.id} style={{ transform: `translateY(${row.start}px)` }}>
                  <button
                    aria-label={`Inspect traceability for ${card.requirement.id}`}
                    className="group w-full rounded-lg border border-border bg-card p-4 text-left text-card-foreground shadow-xs transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onOpen(card.requirement.id)}
                    type="button"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{card.requirement.id}</span>
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">{card.requirement.ears.pattern.replaceAll("_", " ")}</span>
                      <span className="rounded-md border border-border px-2 py-0.5 text-xs">{card.requirement.req_type} · {card.requirement.priority}</span>
                      <span className="ml-auto text-xs font-medium text-muted-foreground group-hover:text-foreground">Inspect chain <Icon aria-hidden="true" className="ml-1 inline size-3" name="ArrowRight" /></span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6">{card.requirement.ears.text}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>evidence: {card.evidenceState.replaceAll("_", " ")}</span>
                      <span>· {card.requirement.standards.length} clause refs</span>
                      <span>· {card.requirement.verification.length} contracts</span>
                      {card.stale ? <span className="text-warning">· stale</span> : null}
                      {card.local ? <span className="text-primary">· local</span> : null}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
          {next ? (
            <div className="flex justify-center py-3">
              <button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => onFilters({ ...filters, cursor: next })} type="button">Next indexed page</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function SelfFetchingTraceRail({
  projectId,
  projectVersionId = null,
  requirementId,
  onNavigate,
}: {
  projectId: string | null;
  projectVersionId?: string | null;
  requirementId: string;
  onNavigate?(subPath: string): void;
}): React.JSX.Element {
  const rpc = useRpc<RpcContract>();
  const [trace, setTrace] = useState<RequirementTraceModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void rpc.call("requirementsList", traceabilityRpcRequest(projectId, projectVersionId, { limit: 1 }, requirementId)).then((page) => {
      if (!active) return;
      const fields = page.items[0] ? parseFields(page.items[0].fields) : null;
      setTrace(fields?.trace ?? null);
      setError(fields?.trace ? null : `Requirement ${requirementId} is not present in the indexed trace view.`);
    }).catch((nextError: unknown) => {
      if (active) setError(nextError instanceof Error ? nextError.message : "Trace rail could not be loaded.");
    });
    return () => { active = false; };
  }, [projectId, projectVersionId, requirementId, rpc]);
  if (!projectId) return <CenteredState detail="Choose a project before resolving requirement traceability." icon="Search" title="Choose a project" />;
  if (error) return <CenteredState detail={error} icon="AlertTriangle" title="Trace rail unavailable" />;
  if (!trace) return <CenteredState detail={`Resolving each segment for ${requirementId}.`} icon="Spinner" title="Loading trace rail" />;
  return <TraceabilityRail onNavigate={onNavigate} rail={trace.rail} />;
}

export function RequirementsTraceabilityLayer({
  projectId,
  detail = ["trace"],
}: {
  projectId: string;
  detail?: readonly string[];
}): React.JSX.Element {
  const route = useMemo(() => parseTraceabilityDetail(detail), [detail]);
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [state, setState] = useState<ViewState>("loading");
  const [items, setItems] = useState<TraceListItem[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [isPending, startTransition] = useTransition();
  const epoch = useRef(0);

  useEffect(() => {
    if (route.malformedId) return;
    const requestEpoch = ++epoch.current;
    setState("loading");
    void rpc.call("requirementsList", traceabilityRpcRequest(
      projectId,
      null,
      route.filters,
      route.requirementId,
      revision > 0,
    )).then((page) => {
      if (epoch.current !== requestEpoch) return;
      const parsed = page.items.map((item) => ({
        fields: parseFields(item.fields),
        projectVersionId: item.projectVersionId,
      }));
      setItems(parsed);
      setTotal(page.total);
      setNext(page.next);
      setMessage(page.cache.message);
      setState("ready");
    }).catch((error: unknown) => {
      if (epoch.current !== requestEpoch) return;
      setMessage(error instanceof Error ? error.message : "Traceability could not be loaded.");
      setState("error");
    });
    return () => { if (epoch.current === requestEpoch) epoch.current += 1; };
  }, [projectId, revision, route.filters, route.malformedId, route.requirementId, rpc]);

  const go = (subPath: string, replace = false) => {
    startTransition(() => navigate.toPluginPanel("product-security", { subPath, replace }));
  };
  if (route.malformedId) {
    return <CenteredState action={<button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted" onClick={() => go(traceabilitySubPath(route.filters), true)} type="button">Return to trace list</button>} detail="The route requirement id is malformed. No RPC or git command was invoked." icon="AlertTriangle" title="Invalid requirement route" />;
  }
  if (route.view === "requirement") {
    const trace = items[0]?.fields.trace ?? null;
    if (state === "loading") return <CenteredState detail={`Resolving independent trace segments for ${route.requirementId}.`} icon="Spinner" title="Loading requirement detail" />;
    if (state === "error" || !trace) return <CenteredState action={<button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted" onClick={() => setRevision((value) => value + 1)} type="button">Retry scoped read</button>} detail={message ?? `Requirement ${route.requirementId ?? ""} was not found in the local index.`} icon="AlertTriangle" title="Requirement trace unavailable" />;
    return <RequirementDetail model={trace} onBack={() => go(traceabilitySubPath(route.filters))} onNavigate={(subPath) => go(subPath)} />;
  }
  const facets = items[0]?.fields.facets;
  return (
    <div aria-busy={isPending} className="h-full min-h-0">
      <RequirementTraceList
        facets={facets}
        filters={route.filters}
        items={items}
        message={message}
        next={next}
        onFilters={(filters) => go(traceabilitySubPath(filters), true)}
        onOpen={(id) => go(traceabilitySubPath(route.filters, id))}
        onRetry={() => setRevision((value) => value + 1)}
        state={state}
        total={total}
      />
    </div>
  );
}
