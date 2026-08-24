import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ListFilterState } from "./filter-bar.js";
import type { TaskSort } from "../../shared/pagination.js";

/**
 * Remembering the task list's scroll offset so opening a task and coming back
 * (or refreshing) lands the user where they left off. This is ephemeral,
 * client-local view state — like the sidebar-collapsed preference it has no
 * server/CLI/SDK surface.
 *
 * We use `sessionStorage` rather than `localStorage`: positions should survive
 * a page refresh within the same tab (a listed requirement) but not linger for
 * days across unrelated sessions, which would otherwise let per-filter keys
 * accumulate unboundedly. An in-memory map backs storage so restoration still
 * works when storage is unavailable (private mode, disabled cookies).
 */
const STORAGE_PREFIX = "bb-tasks:list-scroll:";

const memoryFallback = new Map<string, number>();

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * A stable key for a distinct list *context*. Two lists with different
 * projects, filters, or sort are different contexts and must not restore each
 * other's offset. Filter arrays are sorted so member order never changes the
 * key.
 */
export function listScrollScopeKey(params: {
  projectId: string | null;
  activeOnly: boolean;
  filters: ListFilterState;
  sort: TaskSort;
}): string {
  const list =
    params.projectId !== null
      ? `project:${params.projectId}`
      : params.activeOnly
        ? "active"
        : "all";
  // JSON-serialize each array (sorted for order independence). Label names are
  // arbitrary user strings, so a delimiter join would let e.g. `["a,b"]` and
  // `["a","b"]` collide into the same key and restore each other's offset.
  const statuses = JSON.stringify([...params.filters.statuses].sort());
  const priorities = JSON.stringify([...params.filters.priorities].sort());
  const labels = JSON.stringify([...params.filters.labelNames].sort());
  return `${list}|s=${statuses}|p=${priorities}|l=${labels}|sort=${params.sort}`;
}

export function readListScroll(scopeKey: string): number | null {
  const memory = memoryFallback.get(scopeKey);
  if (memory !== undefined) return memory;
  const store = storage();
  if (store === null) return null;
  let raw: string | null;
  try {
    // getItem itself can throw in some locked-down storage contexts, not just
    // the initial `window.sessionStorage` access — keep the read total.
    raw = store.getItem(STORAGE_PREFIX + scopeKey);
  } catch {
    return null;
  }
  // Only accept a complete non-negative integer; reject partials like
  // "400garbage" that Number.parseInt would otherwise truncate to 400.
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export function writeListScroll(scopeKey: string, offset: number): void {
  const rounded = Math.max(0, Math.round(offset));
  memoryFallback.set(scopeKey, rounded);
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(STORAGE_PREFIX + scopeKey, String(rounded));
  } catch {
    // Best-effort; the in-memory fallback still serves this session.
  }
}

/**
 * Clamp a remembered offset to what the container can actually scroll now. A
 * shortened list (fewer/collapsed rows) must not leave the view scrolled past
 * its end; a `saved` beyond range snaps to the bottom, and an empty/short list
 * yields 0.
 */
export function resolveRestoreTarget(
  saved: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.min(Math.max(0, saved), max);
}

interface ListScrollState {
  /** True once real rows (not skeletons/empty state) are in the DOM. */
  contentReady: boolean;
  /**
   * True while a fetch for the current scope is in flight. `useListTasks`
   * retains the previous filter/sort's rows during a refetch, so the container
   * can briefly be shorter than the settled list; while loading we keep
   * re-applying the target as content grows and only finalize once it clears.
   */
  loading: boolean;
  /**
   * Changes whenever the rendered row set changes (row count is a faithful
   * proxy since rows are fixed height). Drives the re-apply pass so a
   * remembered offset survives late-arriving rows growing the scroll height.
   */
  revision: number;
}

/**
 * Restore the list container's scroll offset for `scopeKey` once its content is
 * laid out, and persist the offset as the user scrolls.
 *
 * The container is reused when switching between the All/Active/project lists
 * (same `ListView` element), so on every scope change we re-target it: pinned
 * to top while the new list loads, then set to the remembered (clamped) offset.
 * This guarantees a reused container never strands a previous list's position.
 *
 * A remembered offset can exceed the height the container has at the instant we
 * first apply it — when the scope changes the previous (shorter) rows are still
 * mounted for a frame, and rows can arrive in more than one paint. We therefore
 * hold the target as `pending` and re-clamp it against the growing scroll
 * height on each revision, finalizing only once the offset is reached or the
 * fetch settles. This keeps the re-apply from ever fighting the user after the
 * list is stable.
 */
export function useListScrollRestoration(
  ref: RefObject<HTMLDivElement | null>,
  scopeKey: string,
  state: ListScrollState,
): void {
  const { contentReady, loading, revision } = state;
  // The scope we've already applied a restore for. While this differs from the
  // active scope we neither trust the container's current offset nor persist
  // it. Re-saving the just-restored offset (from the synthetic scroll event the
  // programmatic write triggers) is harmless — it writes the same value back.
  const restoredScope = useRef<string | null>(null);
  // The remembered offset we're still trying to reach for the active scope, or
  // null once reached / finalized. Guards the re-apply pass from disturbing a
  // settled list on later refetches.
  const pending = useRef<number | null>(null);
  // The offset our own programmatic writes last set. A scroll event landing on
  // a materially different offset is the user, and cancels any pending restore
  // so a later refetch can never yank them back to the target.
  const lastApplied = useRef<number | null>(null);
  // The last offset observed from a real scroll event *while the container was
  // connected*, per active scope. We flush this on unmount rather than reading
  // `el.scrollTop` there: by the time the cleanup runs React has already
  // detached the container (leaving to a task), and a detached element reports
  // scrollTop 0 — which would clobber the good value the scroll writes saved.
  const lastOffset = useRef<number | null>(null);

  // Initial restore when the scope changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (restoredScope.current === scopeKey) return;
    if (!contentReady) {
      // New scope still loading: keep the reused container pinned to top so no
      // stale offset flashes, but don't mark it restored yet.
      el.scrollTop = 0;
      return;
    }
    restoredScope.current = scopeKey;
    const saved = readListScroll(scopeKey);
    if (saved === null) {
      el.scrollTop = 0;
      lastApplied.current = 0;
      pending.current = null;
      return;
    }
    const clamped = resolveRestoreTarget(saved, el.scrollHeight, el.clientHeight);
    el.scrollTop = clamped;
    lastApplied.current = clamped;
    // Keep chasing the target only if the current height can't honor it yet and
    // more rows may still arrive; otherwise we're done.
    pending.current = clamped < saved && loading ? saved : null;
  }, [ref, scopeKey, contentReady, loading]);

  // Re-apply the pending target as late-arriving rows grow the scroll height,
  // then finalize once the offset is reached or the fetch settles.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (restoredScope.current !== scopeKey) return;
    if (pending.current === null) return;
    const clamped = resolveRestoreTarget(
      pending.current,
      el.scrollHeight,
      el.clientHeight,
    );
    el.scrollTop = clamped;
    lastApplied.current = clamped;
    if (clamped >= pending.current || !loading) pending.current = null;
  }, [ref, scopeKey, revision, loading]);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    // Fresh scope: forget the previous scope's observed offset so an unmount
    // without any scroll here can't flush a stale value under this key.
    lastOffset.current = null;
    let raf = 0;
    const onScroll = () => {
      // Don't persist until this scope has been restored, otherwise the
      // pinned-to-top or transitional offset would clobber the saved value.
      if (restoredScope.current !== scopeKey) return;
      // A scroll to an offset we didn't programmatically apply is the user;
      // abandon any in-flight restore so a later refetch can't override them.
      if (
        pending.current !== null &&
        Math.abs(el.scrollTop - (lastApplied.current ?? el.scrollTop)) > 2
      ) {
        pending.current = null;
      }
      lastOffset.current = el.scrollTop;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => writeListScroll(scopeKey, el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      // Flush the latest connected-observed offset so an in-flight debounced
      // write is never lost when leaving to a task.
      if (restoredScope.current === scopeKey && lastOffset.current !== null) {
        writeListScroll(scopeKey, lastOffset.current);
      }
    };
  }, [ref, scopeKey]);
}
