import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRealtime, useRpc } from "@bb/plugin-sdk/app";
import type { findingsUiRpcContract } from "../rpc.js";
import { findingRow, type FindingRow } from "./columns.js";
import { normalizeFindingsFilter, type FindingsFilter } from "./route.js";

type CacheState = { state: "fresh" | "stale" | "empty"; asOf: string | null; message: string | null };

export interface FindingsData {
  rows: readonly FindingRow[];
  total: number;
  next: string | null;
  cache: CacheState | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  pageError: string | null;
  loadMore(): Promise<void>;
  retry(): Promise<void>;
}

function rpcFilter(filter: FindingsFilter) {
  const normalized = normalizeFindingsFilter(filter);
  return {
    ...(normalized.severity ? { severity: normalized.severity } : {}),
    ...(normalized.reachability ? { reachability: normalized.reachability } : {}),
    ...(normalized.kev ? { kev: normalized.kev } : {}),
    ...(normalized.epssGte !== undefined ? { epssGte: normalized.epssGte } : {}),
    ...(normalized.component ? { component: normalized.component } : {}),
    ...(normalized.cve ? { cve: normalized.cve } : {}),
    ...(normalized.triage ? { triage: normalized.triage } : {}),
    ...(normalized.findingType ? { findingType: normalized.findingType } : {}),
    ...(normalized.localState ? { localState: normalized.localState } : {}),
  };
}

export function useFindings(projectId: string | null, projectVersionId: string | null, filter: FindingsFilter): FindingsData {
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const rowsRef = useRef<FindingRow[]>([]);
  const keysRef = useRef(new Set<string>());
  const generationRef = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const [, setRowVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [cache, setCache] = useState<CacheState | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId && projectVersionId));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const filterKey = useMemo(() => JSON.stringify(rpcFilter(filter)), [filter]);

  const read = useCallback(async (continuation: string | null, append: boolean, generation: number) => {
    if (!projectId || !projectVersionId) return;
    const page = await rpc.call("findingsUiList", {
      projectId,
      projectVersionId,
      pageSize: 100,
      continuation,
      filters: rpcFilter(filterRef.current),
    });
    if (generation !== generationRef.current) return;
    if (!append) {
      rowsRef.current = [];
      keysRef.current = new Set();
    }
    for (const item of page.items) {
      const row = findingRow(item);
      if (keysRef.current.has(row.stableKey)) continue;
      keysRef.current.add(row.stableKey);
      rowsRef.current.push(row);
    }
    setRowVersion(value => value + 1);
    setTotal(page.total ?? rowsRef.current.length);
    setNext(page.next);
    setCache(page.cache);
    setError(null);
    setPageError(null);
  }, [projectId, projectVersionId, rpc]);

  const retry = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    try { await read(null, false, generation); }
    catch (cause) { if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : "Findings could not be loaded."); }
    finally { if (generation === generationRef.current) setLoading(false); }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void retry(); }, 180);
    return () => window.clearTimeout(timer);
  }, [filterKey, projectId, projectVersionId, retry]);

  const loadMore = useCallback(async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    const generation = generationRef.current;
    try { await read(next, true, generation); }
    catch (cause) { if (generation === generationRef.current) setPageError(cause instanceof Error ? cause.message : "The next page could not be loaded."); }
    finally { if (generation === generationRef.current) setLoadingMore(false); }
  }, [loadingMore, next, read]);

  useRealtime("fs-findings-pull", payload => {
    if (typeof payload !== "object" || payload === null || !("pvId" in payload) || payload.pvId !== projectVersionId) return;
    if ("phase" in payload && payload.phase === "done") void retry();
  });

  return { rows: rowsRef.current, total, next, cache, loading, loadingMore, error, pageError, loadMore, retry };
}
