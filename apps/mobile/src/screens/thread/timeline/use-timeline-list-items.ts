import { collectTimelineAutoExpansionRowIds } from "@bb/client-core";
import type { TimelineRow } from "@bb/server-contract";
import {
  buildTimelineViewRows,
  createTimelineViewRowsCache,
} from "@bb/thread-view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTimelineListItems,
  createTimelineListItemCache,
  createTimelineTitleCache,
  type TimelineListItem,
  type TimelineTurnChildrenState,
} from "./rows";

interface UseTimelineListItemsArgs {
  rows: readonly TimelineRow[];
  /** Thread runtime is running. */
  scopeActive: boolean;
  /** Lazily loaded children for expanded turn rows, keyed by item key. */
  turnChildren: ReadonlyMap<string, TimelineTurnChildrenState>;
  /** Resets the user's disclosure choices (thread switch). */
  resetKey: string;
}

interface UseTimelineListItemsResult {
  /** Flat list items; each carries its own `expanded` flag. */
  items: TimelineListItem[];
  /** Stable across renders (safe to hand to memoized cells). */
  toggleRow: (rowId: string) => void;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Disclosure state + flat list items for the timeline (the native stand-in
 * for the per-row `useState` disclosures of the web rows). A row is open
 * when the user toggled it open, or — absent a user choice — when the
 * client-core auto-expand rule selects it: live-frontier rows while they are
 * the frontier, terminal-frontier rows (system errors) from the moment they
 * arrive, kept open afterwards like the web row preserves its disclosure.
 */
export function useTimelineListItems({
  rows,
  scopeActive,
  turnChildren,
  resetKey,
}: UseTimelineListItemsArgs): UseTimelineListItemsResult {
  const viewCacheRef = useRef(createTimelineViewRowsCache());
  const titleCacheRef = useRef(createTimelineTitleCache());
  const itemCacheRef = useRef(createTimelineListItemCache());
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [stickyAutoExpanded, setStickyAutoExpanded] =
    useState<ReadonlySet<string>>(EMPTY_SET);

  useEffect(() => {
    setOverrides(new Map());
    setStickyAutoExpanded(EMPTY_SET);
  }, [resetKey]);

  const viewRows = useMemo(
    () => buildTimelineViewRows(rows, { cache: viewCacheRef.current }),
    [rows],
  );
  const autoExpansion = useMemo(
    () => collectTimelineAutoExpansionRowIds({ rows: viewRows, scopeActive }),
    [scopeActive, viewRows],
  );

  // Terminal-frontier rows stay open once auto-opened.
  useEffect(() => {
    const terminalIds = autoExpansion.terminalFrontierRowIds;
    if (terminalIds.size === 0) return;
    setStickyAutoExpanded((current) => {
      let next: Set<string> | null = null;
      for (const id of terminalIds) {
        if (current.has(id)) continue;
        next ??= new Set(current);
        next.add(id);
      }
      return next ?? current;
    });
  }, [autoExpansion.terminalFrontierRowIds]);

  const expandedRowIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of autoExpansion.liveFrontierRowIds) ids.add(id);
    for (const id of stickyAutoExpanded) ids.add(id);
    for (const [id, expanded] of overrides) {
      if (expanded) ids.add(id);
      else ids.delete(id);
    }
    return ids;
  }, [autoExpansion.liveFrontierRowIds, overrides, stickyAutoExpanded]);

  // Read through a ref so the callback identity survives disclosure changes
  // (the list cells memoize on it).
  const expandedRowIdsRef = useRef(expandedRowIds);
  useEffect(() => {
    expandedRowIdsRef.current = expandedRowIds;
  }, [expandedRowIds]);
  const toggleRow = useCallback((rowId: string) => {
    const currentlyExpanded = expandedRowIdsRef.current.has(rowId);
    setOverrides((current) => {
      const next = new Map(current);
      next.set(rowId, !currentlyExpanded);
      return next;
    });
  }, []);

  const items = useMemo(
    () =>
      buildTimelineListItems({
        rows,
        scopeActive,
        isExpanded: (rowId) => expandedRowIds.has(rowId),
        turnChildren,
        cache: viewCacheRef.current,
        titleCache: titleCacheRef.current,
        itemCache: itemCacheRef.current,
      }),
    [expandedRowIds, rows, scopeActive, turnChildren],
  );

  return { items, toggleRow };
}
