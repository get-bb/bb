import {
  DIFF_PATCH_MAX_PATHS_PER_REQUEST,
  type DiffFileEntry,
  type EnvironmentDiffPatchResponse,
} from "@bb/server-contract";

/**
 * The pure half of `useEnvironmentDiffPatches` (mirror of the helpers in
 * apps/app/src/hooks/queries/use-environment-diff-patches.ts): the in-flight
 * / error bookkeeping per path, the viewport → fetch-page selection, and the
 * per-file tiering decision. No React, vitest-tested.
 */

export type DiffPatchStatus = "idle" | "loading" | "loaded" | "error";

export interface DiffPatchState {
  status: DiffPatchStatus;
  patch?: string;
  truncated?: boolean;
  error?: string;
}

const IDLE_PATCH_STATE: DiffPatchState = { status: "idle" };

/** In-flight / errored tracking for the active target, keyed by path. */
export interface InFlightState {
  /** Eviction generation captured when the fetch for a path started. */
  loading: ReadonlyMap<string, number>;
  errors: ReadonlyMap<string, string>;
}

export const EMPTY_IN_FLIGHT: InFlightState = {
  loading: new Map(),
  errors: new Map(),
};

/**
 * The visible + overscan `auto` paths the list wants patches for. `visible`
 * rows are fetched before `overscan` so on-screen content settles first; a
 * path present in both is treated as visible.
 */
export interface RequestedPaths {
  visible: readonly string[];
  overscan: readonly string[];
}

export function dedupeOrderedPaths(args: RequestedPaths): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of [...args.visible, ...args.overscan]) {
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

/** Split into `POST /diff/patch` pages of at most 50 paths, in order. */
export function chunkPaths(paths: readonly string[]): string[][] {
  const pages: string[][] = [];
  for (
    let index = 0;
    index < paths.length;
    index += DIFF_PATCH_MAX_PATHS_PER_REQUEST
  ) {
    pages.push(paths.slice(index, index + DIFF_PATCH_MAX_PATHS_PER_REQUEST));
  }
  return pages;
}

export function isLoadingForCurrentGeneration(
  loading: ReadonlyMap<string, number>,
  path: string,
  currentEvictionGeneration: number,
): boolean {
  const loadingGeneration = loading.get(path);
  return (
    loadingGeneration !== undefined &&
    loadingGeneration >= currentEvictionGeneration
  );
}

export interface SelectPathsToFetchArgs {
  requested: RequestedPaths;
  inFlight: InFlightState;
  currentEvictionGeneration: number;
  /** Whether the patch is already cached for the active target. */
  isCached: (path: string) => boolean;
}

/**
 * Which of the requested paths a settle tick must fetch: not cached, not
 * loading under the current generation, not errored (errors clear only via
 * an explicit retry so a failing file does not re-request on every scroll).
 */
export function selectPathsToFetch({
  requested,
  inFlight,
  currentEvictionGeneration,
  isCached,
}: SelectPathsToFetchArgs): string[] {
  return dedupeOrderedPaths(requested).filter((path) => {
    if (isCached(path)) return false;
    if (
      isLoadingForCurrentGeneration(
        inFlight.loading,
        path,
        currentEvictionGeneration,
      )
    ) {
      return false;
    }
    return !inFlight.errors.has(path);
  });
}

export function markLoading(
  previous: InFlightState,
  paths: readonly string[],
  loadingGeneration: number,
): InFlightState {
  const loading = new Map(previous.loading);
  const errors = new Map(previous.errors);
  for (const path of paths) {
    loading.set(path, loadingGeneration);
    errors.delete(path);
  }
  return { loading, errors };
}

/**
 * Stamped on a path the server omitted from an `available` response — e.g.
 * it left the diff's table of contents between the list fetch and this
 * request. Marking it terminal (rather than leaving it idle) stops a
 * re-request loop; a TOC refresh drops the row entirely.
 */
export const MISSING_PATCH_MESSAGE = "No diff was available for this file.";

export interface SettlePageArgs {
  previous: InFlightState;
  paths: readonly string[];
  /** Eviction generation captured when this page started loading. */
  loadingGeneration: number;
  /** Page-level error: a thrown request, or a non-`available` outcome. */
  error?: string;
  /** For an `available` page: the paths the server actually returned. */
  returnedPaths?: ReadonlySet<string>;
}

/**
 * A page resolved: release its paths from `loading` (only the generation it
 * started under — a newer fetch for the same path stays loading) and record
 * the outcome per path.
 */
export function settlePage({
  previous,
  paths,
  loadingGeneration,
  error,
  returnedPaths,
}: SettlePageArgs): InFlightState {
  const loading = new Map(previous.loading);
  const errors = new Map(previous.errors);
  for (const path of paths) {
    if (loading.get(path) === loadingGeneration) {
      loading.delete(path);
    }
    if (error !== undefined) {
      errors.set(path, error);
    } else if (returnedPaths !== undefined && !returnedPaths.has(path)) {
      errors.set(path, MISSING_PATCH_MESSAGE);
    } else {
      errors.delete(path);
    }
  }
  return { loading, errors };
}

export function clearError(
  previous: InFlightState,
  path: string,
): InFlightState {
  if (!previous.errors.has(path)) return previous;
  const errors = new Map(previous.errors);
  errors.delete(path);
  return { loading: previous.loading, errors };
}

/**
 * Release paths from `loading` without caching or erroring them — used when a
 * mid-flight eviction supersedes a fetch. Only the matching stale generation
 * is cleared; a newer fetch for the same path remains loading.
 */
export function clearLoading(
  previous: InFlightState,
  paths: readonly string[],
  loadingGeneration: number,
): InFlightState {
  if (!paths.some((path) => previous.loading.get(path) === loadingGeneration)) {
    return previous;
  }
  const loading = new Map(previous.loading);
  for (const path of paths) {
    if (loading.get(path) === loadingGeneration) {
      loading.delete(path);
    }
  }
  return { loading, errors: previous.errors };
}

/** The page-level error of a non-`available` patch response. */
export function patchPageError(
  response: EnvironmentDiffPatchResponse,
): string | undefined {
  switch (response.outcome) {
    case "available":
      return undefined;
    case "not_applicable":
      return response.message;
    case "unavailable":
      return response.failure.message;
  }
}

export interface ResolvePatchStateArgs {
  cached: { patch: string; truncated: boolean } | undefined;
  inFlight: InFlightState;
  path: string;
}

/** A file's patch state: cached beats errored beats loading beats idle. */
export function resolvePatchState({
  cached,
  inFlight,
  path,
}: ResolvePatchStateArgs): DiffPatchState {
  if (cached !== undefined) {
    return {
      status: "loaded",
      patch: cached.patch,
      truncated: cached.truncated,
    };
  }
  const error = inFlight.errors.get(path);
  if (error !== undefined) {
    return { status: "error", error };
  }
  if (inFlight.loading.has(path)) {
    return { status: "loading" };
  }
  return IDLE_PATCH_STATE;
}

export interface ViewportPaths {
  visible: string[];
  overscan: string[];
}

/**
 * The `auto`-tier paths of the mounted rows, split into on-screen and
 * overscan. `on_demand` files load from their button and `too_large` files
 * are never fetched, so neither is requested from the viewport.
 */
export function collectViewportPatchPaths(
  files: readonly DiffFileEntry[],
  visibleRange: { start: number; end: number } | null,
  mountedRange: { start: number; end: number } | null,
): ViewportPaths {
  const visible: string[] = [];
  const overscan: string[] = [];
  if (mountedRange === null) {
    return { visible, overscan };
  }
  const visibleStart = visibleRange?.start ?? mountedRange.start;
  const visibleEnd = visibleRange?.end ?? mountedRange.end;
  for (let index = mountedRange.start; index <= mountedRange.end; index += 1) {
    const entry = files[index];
    if (!entry || entry.loadMode !== "auto") continue;
    if (index >= visibleStart && index <= visibleEnd) {
      visible.push(entry.path);
    } else {
      overscan.push(entry.path);
    }
  }
  return { visible, overscan };
}

/** What the card body shows for a file given its tier and patch state. */
export type DiffFileBodyState =
  | { kind: "error"; message: string }
  | { kind: "too-large" }
  | { kind: "load-on-demand" }
  | { kind: "loading" }
  | { kind: "loaded"; patch: string; truncated: boolean };

/**
 * Tiering: `too_large` never loads; `on_demand` waits for the button while
 * idle; `auto` (and a requested `on_demand`) shows a skeleton until the
 * patch lands. An error wins over every tier (it carries Retry).
 */
export function resolveDiffFileBodyState(
  entry: Pick<DiffFileEntry, "loadMode">,
  patchState: DiffPatchState,
): DiffFileBodyState {
  if (patchState.status === "error") {
    return {
      kind: "error",
      message: patchState.error ?? "Failed to load this file's diff.",
    };
  }
  if (patchState.status === "loaded" && patchState.patch !== undefined) {
    return {
      kind: "loaded",
      patch: patchState.patch,
      truncated: patchState.truncated ?? false,
    };
  }
  if (entry.loadMode === "too_large") {
    return { kind: "too-large" };
  }
  if (entry.loadMode === "on_demand" && patchState.status === "idle") {
    return { kind: "load-on-demand" };
  }
  return { kind: "loading" };
}
