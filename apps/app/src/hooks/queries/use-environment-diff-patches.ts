import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceDiffTarget } from "@bb/domain";
import {
  DIFF_PATCH_MAX_PATHS_PER_REQUEST,
  type DiffPatchEntry,
  type EnvironmentDiffPatchResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { extractErrorMessage } from "@bb/core-ui";
import {
  type PatchQueryIdentity,
  getDiffPatchEvictionGeneration,
  readDiffPatchEntry,
  writeDiffPatchEntry,
} from "../cache-owners/environment-diff-patch-cache-owner";
import { environmentDiffTargetKey } from "./query-keys";

/** Debounce window for coalescing scroll-driven patch requests. */
const PATCH_REQUEST_DEBOUNCE_MS = 80;

export type DiffPatchStatus = "idle" | "loading" | "loaded" | "error";

export interface DiffPatchState {
  status: DiffPatchStatus;
  patch?: string;
  truncated?: boolean;
  error?: string;
}

/**
 * The visible + overscan `auto` paths the virtualized list wants patches for.
 * `visible` rows are fetched before `overscan` so on-screen content settles
 * first; a path present in both is treated as visible.
 */
export interface RequestDiffPatchPathsArgs {
  visible: string[];
  overscan: string[];
}

export interface UseEnvironmentDiffPatchesArgs {
  target?: WorkspaceDiffTarget;
}

export type RequestDiffPatchPaths = (args: RequestDiffPatchPathsArgs) => void;
export type GetDiffPatchState = (path: string) => DiffPatchState;
export type RetryDiffPatchPath = (path: string) => void;
export type LoadDiffPatchPath = (path: string) => void;
export type SeedDiffPatchEntries = (entries: DiffPatchEntry[]) => void;

export interface UseEnvironmentDiffPatchesResult {
  requestPaths: RequestDiffPatchPaths;
  getPatchState: GetDiffPatchState;
  retry: RetryDiffPatchPath;
  loadPath: LoadDiffPatchPath;
  /**
   * Prime the cache with patches the TOC shipped inline (`initialPatches`) so
   * the first screen renders without a separate fetch. Idempotent.
   */
  seedInitialPatches: SeedDiffPatchEntries;
}

const IDLE_STATE: DiffPatchState = { status: "idle" };

interface PendingPaths {
  visible: string[];
  overscan: string[];
}

/** In-flight / errored tracking for the active target, keyed by path. */
interface InFlightState {
  loading: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
}

const EMPTY_IN_FLIGHT: InFlightState = {
  loading: new Set(),
  errors: new Map(),
};

function abortPatchRequests(controllers: Set<AbortController>): void {
  for (const controller of controllers) {
    controller.abort();
  }
  controllers.clear();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function dedupeOrderedPaths(args: PendingPaths): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of [...args.visible, ...args.overscan]) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    ordered.push(path);
  }
  return ordered;
}

function chunkPaths(paths: string[]): string[][] {
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

function patchPageError(
  response: EnvironmentDiffPatchResponse,
): string | undefined {
  switch (response.outcome) {
    case "available":
      return undefined;
    case "not_applicable":
      return response.message;
    case "unavailable":
      return response.failure.message;
    default: {
      const _exhaustive: never = response;
      return _exhaustive;
    }
  }
}

/**
 * Drives the diff tab's per-file patch loading. The virtualized list reports
 * which `auto` paths are visible + within overscan; this hook coalesces those
 * reports, fetches the not-yet-loaded ones in viewport-first pages of at most
 * {@link DIFF_PATCH_MAX_PATHS_PER_REQUEST}, and caches each file's patch under a
 * per-(target, path) React Query key so re-scrolling never refetches.
 *
 * Each fetched page is keyed to the active diff target; responses for a target
 * that has since changed are dropped, and switching target resets observed
 * loading/error state. A failed page (network error, or a daemon
 * `unavailable` / `not_applicable` outcome) marks only its paths as a
 * retryable error rather than throwing — call {@link UseEnvironmentDiffPatchesResult.retry}
 * to re-request a single path.
 */
export function useEnvironmentDiffPatches(
  environmentId: string,
  { target }: UseEnvironmentDiffPatchesArgs,
): UseEnvironmentDiffPatchesResult {
  const queryClient = useQueryClient();

  const targetType = target?.type ?? null;
  const targetKey = environmentDiffTargetKey(target);
  // Single string identity for the active target; changes here invalidate every
  // in-flight request and reset observed loading/error state.
  const targetIdentity = `${targetType ?? "none"}:${targetKey ?? ""}`;

  const identity = useMemo<PatchQueryIdentity>(
    () => ({ environmentId, targetType, targetKey }),
    [environmentId, targetType, targetKey],
  );

  const [inFlight, setInFlight] = useState<InFlightState>(EMPTY_IN_FLIGHT);

  // Latest reported paths and the active target identity are held in refs so the
  // debounced settle tick reads current values without re-subscribing on every
  // scroll report. `inFlightRef` mirrors the in-flight state so the settle tick
  // can dedupe against it without taking it as a dependency (which would
  // reschedule the callback on every state change).
  const pendingPathsRef = useRef<PendingPaths>({ visible: [], overscan: [] });
  const targetIdentityRef = useRef(targetIdentity);
  const inFlightRef = useRef(inFlight);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  // Mirror in-flight state into a ref from an effect — never during render, which
  // is unsafe under concurrent rendering — so the debounced settle tick can dedupe
  // against the latest committed state without taking it as a dependency.
  useEffect(() => {
    inFlightRef.current = inFlight;
  }, [inFlight]);

  // Reset all observed loading/error state and drop any pending settle tick when
  // the target changes; cached patches for the new target are re-read lazily.
  useEffect(() => {
    targetIdentityRef.current = targetIdentity;
    pendingPathsRef.current = { visible: [], overscan: [] };
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortPatchRequests(abortControllersRef.current);
    setInFlight(EMPTY_IN_FLIGHT);
  }, [targetIdentity]);

  useEffect(() => {
    const abortControllers = abortControllersRef.current;
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      abortPatchRequests(abortControllers);
    };
  }, []);

  const fetchPage = useCallback(
    async (paths: string[], generationTarget: string) => {
      if (!environmentId || target === undefined) {
        return;
      }
      // Snapshot the environment's eviction generation at fetch start. If the
      // patch cache is evicted (a content edit, ref move, or reconnect) while
      // this request is in flight, the generation advances and the resolved
      // response is dropped — re-seeding the just-cleared cache here would leave
      // a pre-edit patch that nothing re-requests. Clearing the paths from
      // `loading` without caching lets the panel's already-re-fired
      // `requestPaths` dispatch re-fetch them fresh.
      const evictionGeneration = getDiffPatchEvictionGeneration(environmentId);
      const controller = new AbortController();
      abortControllersRef.current.add(controller);
      try {
        const response = await api.getEnvironmentDiffPatches(environmentId, {
          target,
          paths,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        // Drop the response if the target changed while it was in flight.
        if (targetIdentityRef.current !== generationTarget) {
          return;
        }
        // Drop the response if the patch cache was evicted while it was in
        // flight, releasing its paths so the panel re-requests them.
        if (
          getDiffPatchEvictionGeneration(environmentId) !== evictionGeneration
        ) {
          setInFlight((previous) => clearLoading(previous, paths));
          return;
        }
        if (response.outcome === "available") {
          const returnedPaths = new Set<string>();
          for (const entry of response.patches) {
            writeDiffPatchEntry({ queryClient, identity, entry });
            returnedPaths.add(entry.path);
          }
          // Any requested path the server omitted (e.g. it left the TOC after the
          // list fetch) is settled to a terminal error, not left idle — otherwise
          // it would be re-requested on every scroll tick.
          setInFlight((previous) =>
            settlePage({ previous, paths, returnedPaths }),
          );
        } else {
          setInFlight((previous) =>
            settlePage({ previous, paths, error: patchPageError(response) }),
          );
        }
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) {
          return;
        }
        if (targetIdentityRef.current !== generationTarget) {
          return;
        }
        // An eviction mid-flight supersedes a failure: release the paths so the
        // panel re-requests them rather than stamping a stale error.
        if (
          getDiffPatchEvictionGeneration(environmentId) !== evictionGeneration
        ) {
          setInFlight((previous) => clearLoading(previous, paths));
          return;
        }
        const message =
          extractErrorMessage(caught) ?? "Failed to load file diff";
        setInFlight((previous) =>
          settlePage({ previous, paths, error: message }),
        );
      } finally {
        abortControllersRef.current.delete(controller);
      }
    },
    [environmentId, target, identity, queryClient],
  );

  const dispatchPending = useCallback(() => {
    debounceTimerRef.current = null;
    if (!environmentId || target === undefined) {
      return;
    }
    // Bail if a newer target became active before this debounced tick ran, so a
    // stale dispatch never marks paths loading under the current target.
    if (targetIdentityRef.current !== targetIdentity) {
      return;
    }
    const ordered = dedupeOrderedPaths(pendingPathsRef.current);

    const toFetch = ordered.filter((path) => {
      if (readDiffPatchEntry({ queryClient, identity, path }) !== undefined) {
        return false;
      }
      if (inFlightRef.current.loading.has(path)) {
        return false;
      }
      if (inFlightRef.current.errors.has(path)) {
        return false;
      }
      return true;
    });

    if (toFetch.length === 0) {
      return;
    }

    setInFlight((previous) => markLoading(previous, toFetch));

    for (const page of chunkPaths(toFetch)) {
      void fetchPage(page, targetIdentity);
    }
  }, [
    environmentId,
    target,
    targetIdentity,
    identity,
    queryClient,
    fetchPage,
  ]);

  const requestPaths = useCallback(
    (args: RequestDiffPatchPathsArgs) => {
      pendingPathsRef.current = {
        visible: args.visible,
        overscan: args.overscan,
      };
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(
        dispatchPending,
        PATCH_REQUEST_DEBOUNCE_MS,
      );
    },
    [dispatchPending],
  );

  // Fetch a single path immediately, bypassing the debounced shared
  // `pendingPathsRef`. A scroll-driven `requestPaths` can replace that ref (and
  // reset its timer) between an `on_demand`/retry click and the debounced
  // dispatch, dropping the click; going direct sidesteps that race entirely.
  const loadPathNow = useCallback(
    (path: string) => {
      const generationTarget = targetIdentityRef.current;
      setInFlight((previous) => markLoading(previous, [path]));
      void fetchPage([path], generationTarget);
    },
    [fetchPage],
  );

  const retry = useCallback(
    (path: string) => {
      setInFlight((previous) => clearError(previous, path));
      loadPathNow(path);
    },
    [loadPathNow],
  );

  // The `on_demand` "Load diff" CTA: fetch this one path now, but never disturb
  // a patch that is already loaded, in flight, or errored (an error clears only
  // via `retry`).
  const loadPath = useCallback(
    (path: string) => {
      if (readDiffPatchEntry({ queryClient, identity, path }) !== undefined) {
        return;
      }
      if (
        inFlightRef.current.loading.has(path) ||
        inFlightRef.current.errors.has(path)
      ) {
        return;
      }
      loadPathNow(path);
    },
    [queryClient, identity, loadPathNow],
  );

  const getPatchState = useCallback(
    (path: string): DiffPatchState => {
      const cached = readDiffPatchEntry({ queryClient, identity, path });
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
      return IDLE_STATE;
    },
    [queryClient, identity, inFlight],
  );

  const seedInitialPatches = useCallback(
    (entries: DiffPatchEntry[]) => {
      for (const entry of entries) {
        writeDiffPatchEntry({ queryClient, identity, entry });
      }
    },
    [queryClient, identity],
  );

  return { requestPaths, getPatchState, retry, loadPath, seedInitialPatches };
}

function markLoading(
  previous: InFlightState,
  paths: string[],
): InFlightState {
  const loading = new Set(previous.loading);
  const errors = new Map(previous.errors);
  for (const path of paths) {
    loading.add(path);
    errors.delete(path);
  }
  return { loading, errors };
}

/**
 * Stamped on a path the server omitted from an `available` response — e.g. it
 * left the diff's table of contents between the list fetch and this request.
 * Marking it terminal (rather than leaving it idle) stops a re-request loop; a
 * TOC refresh drops the row entirely.
 */
const MISSING_PATCH_MESSAGE = "No diff was available for this file.";

interface SettlePageArgs {
  previous: InFlightState;
  paths: string[];
  /** Page-level error: a thrown request, or a non-`available` outcome. */
  error?: string;
  /** For an `available` page: the paths the server actually returned. */
  returnedPaths?: ReadonlySet<string>;
}

function settlePage({
  previous,
  paths,
  error,
  returnedPaths,
}: SettlePageArgs): InFlightState {
  const loading = new Set(previous.loading);
  const errors = new Map(previous.errors);
  for (const path of paths) {
    loading.delete(path);
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

function clearError(previous: InFlightState, path: string): InFlightState {
  if (!previous.errors.has(path)) {
    return previous;
  }
  const errors = new Map(previous.errors);
  errors.delete(path);
  return { loading: previous.loading, errors };
}

/**
 * Release paths from `loading` without caching or erroring them — used when a
 * mid-flight eviction supersedes a fetch, so the panel's re-fired `requestPaths`
 * dispatch re-fetches them fresh (a still-`loading` path is skipped).
 */
function clearLoading(
  previous: InFlightState,
  paths: string[],
): InFlightState {
  if (!paths.some((path) => previous.loading.has(path))) {
    return previous;
  }
  const loading = new Set(previous.loading);
  for (const path of paths) {
    loading.delete(path);
  }
  return { loading, errors: previous.errors };
}
