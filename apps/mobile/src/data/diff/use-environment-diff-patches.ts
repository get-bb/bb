import type { WorkspaceDiffTarget } from "@bb/domain";
import type { DiffPatchEntry } from "@bb/server-contract";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  getDiffPatchEvictionGeneration,
  readDiffPatchEntry,
  retainDiffPatchQueries,
  writeDiffPatchEntry,
  type PatchQueryIdentity,
} from "@/lib/query/diff-patch-cache";
import { getMutationErrorMessage } from "@/lib/query/mutation-errors";
import {
  chunkPaths,
  clearError,
  clearLoading,
  EMPTY_IN_FLIGHT,
  isLoadingForCurrentGeneration,
  markLoading,
  patchPageError,
  resolvePatchState,
  selectPathsToFetch,
  settlePage,
  type DiffPatchState,
  type InFlightState,
  type RequestedPaths,
} from "./diff-patch-state";
import { diffTargetKey } from "./diff-target";

/** Debounce window for coalescing scroll-driven patch requests. */
const PATCH_REQUEST_DEBOUNCE_MS = 80;

export type RequestDiffPatchPaths = (args: RequestedPaths) => void;
export type GetDiffPatchState = (path: string) => DiffPatchState;
export type LoadDiffPatchPath = (path: string) => void;

export interface UseEnvironmentDiffPatchesResult {
  /** The list's visible + overscan `auto` paths; coalesced and fetched in pages. */
  requestPaths: RequestDiffPatchPaths;
  getPatchState: GetDiffPatchState;
  /** Re-request one path after an error. */
  retry: LoadDiffPatchPath;
  /** The `on_demand` "Load diff" button: fetch this one path now. */
  loadPath: LoadDiffPatchPath;
  /** Prime the cache with the TOC's inline first-screen patches. Idempotent. */
  seedInitialPatches: (entries: readonly DiffPatchEntry[]) => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function abortAll(controllers: Set<AbortController>): void {
  for (const controller of controllers) controller.abort();
  controllers.clear();
}

/**
 * Drives the diff tab's per-file patch loading (port of
 * apps/app/src/hooks/queries/use-environment-diff-patches.ts). The list
 * reports which `auto` paths are visible + within overscan; the hook
 * coalesces those reports (80 ms), fetches the not-yet-loaded ones in
 * viewport-first `POST /environments/:id/diff/patch` pages of at most 50
 * paths, and caches each file's patch under a per-(target, path) query key
 * so re-scrolling never refetches.
 *
 * Each fetched page is keyed to the active diff target; responses for a
 * target that has since changed are dropped, and switching target resets the
 * observed loading / error state. A response that lands after the patch
 * cache was evicted (a realtime workspace event) is dropped too, so a
 * pre-edit patch never re-seeds the just-cleared cache. A failed page marks
 * only its paths as a retryable error rather than throwing.
 */
export function useEnvironmentDiffPatches(
  environmentId: string,
  target: WorkspaceDiffTarget,
): UseEnvironmentDiffPatchesResult {
  const { sdk } = useProfileClient();
  const queryClient = useQueryClient();

  const targetType = target.type;
  const targetKey = diffTargetKey(target);
  // Single string identity for the active target; a change here invalidates
  // every in-flight request and resets observed loading/error state.
  const targetIdentity = `${targetType}:${targetKey ?? ""}`;
  const identity = useMemo<PatchQueryIdentity>(
    () => ({ environmentId, targetType, targetKey }),
    [environmentId, targetType, targetKey],
  );

  const [inFlight, setInFlight] = useState<InFlightState>(EMPTY_IN_FLIGHT);
  // Bumped when patches are written outside a state transition (seeding) so
  // `getPatchState` readers re-render and read the fresh cache.
  const [cacheVersion, setCacheVersion] = useState(0);
  const inFlightRef = useRef(inFlight);
  const pendingPathsRef = useRef<RequestedPaths>({ visible: [], overscan: [] });
  const targetIdentityRef = useRef(targetIdentity);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  // Mirror the committed state into a ref from an effect (never during
  // render) so the debounced settle tick dedupes against the latest state
  // without taking it as a dependency.
  useEffect(() => {
    inFlightRef.current = inFlight;
  }, [inFlight]);

  // Target switch: drop pending reports, abort in-flight pages, reset state.
  useEffect(() => {
    targetIdentityRef.current = targetIdentity;
    pendingPathsRef.current = { visible: [], overscan: [] };
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortAll(abortControllersRef.current);
    setInFlight(EMPTY_IN_FLIGHT);
  }, [targetIdentity]);

  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      abortAll(controllers);
    };
  }, []);

  // Cached patches have no observers; this lease keeps them resident and the
  // last release schedules the bounded eviction.
  useEffect(() => {
    if (!environmentId) return;
    return retainDiffPatchQueries(queryClient, environmentId);
  }, [environmentId, queryClient]);

  const fetchPage = useCallback(
    async (paths: string[], pageTarget: string) => {
      if (!environmentId) return;
      const generation = getDiffPatchEvictionGeneration(
        queryClient,
        environmentId,
      );
      const controller = new AbortController();
      abortControllersRef.current.add(controller);
      try {
        const response = await sdk.environments.diffPatch({
          environmentId,
          target,
          paths,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (targetIdentityRef.current !== pageTarget) return;
        if (
          getDiffPatchEvictionGeneration(queryClient, environmentId) !==
          generation
        ) {
          // Evicted mid-flight: release the paths so the list re-requests.
          setInFlight((previous) => clearLoading(previous, paths, generation));
          return;
        }
        if (response.outcome === "available") {
          const returnedPaths = new Set<string>();
          for (const entry of response.patches) {
            writeDiffPatchEntry(queryClient, identity, entry);
            returnedPaths.add(entry.path);
          }
          setInFlight((previous) =>
            settlePage({
              previous,
              paths,
              loadingGeneration: generation,
              returnedPaths,
            }),
          );
        } else {
          setInFlight((previous) =>
            settlePage({
              previous,
              paths,
              loadingGeneration: generation,
              error: patchPageError(response),
            }),
          );
        }
      } catch (caught) {
        if (isAbortError(caught) || controller.signal.aborted) return;
        if (targetIdentityRef.current !== pageTarget) return;
        if (
          getDiffPatchEvictionGeneration(queryClient, environmentId) !==
          generation
        ) {
          setInFlight((previous) => clearLoading(previous, paths, generation));
          return;
        }
        setInFlight((previous) =>
          settlePage({
            previous,
            paths,
            loadingGeneration: generation,
            error: getMutationErrorMessage({
              error: caught,
              fallbackMessage: "Failed to load file diff",
            }),
          }),
        );
      } finally {
        abortControllersRef.current.delete(controller);
      }
    },
    [environmentId, identity, queryClient, sdk, target],
  );

  const dispatchPending = useCallback(() => {
    debounceTimerRef.current = null;
    if (!environmentId) return;
    // A newer target became active before this tick ran.
    if (targetIdentityRef.current !== targetIdentity) return;
    const generation = getDiffPatchEvictionGeneration(
      queryClient,
      environmentId,
    );
    const toFetch = selectPathsToFetch({
      requested: pendingPathsRef.current,
      inFlight: inFlightRef.current,
      currentEvictionGeneration: generation,
      isCached: (path) =>
        readDiffPatchEntry(queryClient, identity, path) !== undefined,
    });
    if (toFetch.length === 0) return;
    setInFlight((previous) => markLoading(previous, toFetch, generation));
    for (const page of chunkPaths(toFetch)) {
      void fetchPage(page, targetIdentity);
    }
  }, [environmentId, fetchPage, identity, queryClient, targetIdentity]);

  const requestPaths = useCallback<RequestDiffPatchPaths>(
    (args) => {
      pendingPathsRef.current = args;
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

  // Fetch one path at once, bypassing the debounced shared report (a scroll
  // report could replace it between a button press and the tick).
  const loadPathNow = useCallback(
    (path: string) => {
      const pageTarget = targetIdentityRef.current;
      const generation = getDiffPatchEvictionGeneration(
        queryClient,
        environmentId,
      );
      setInFlight((previous) => markLoading(previous, [path], generation));
      void fetchPage([path], pageTarget);
    },
    [environmentId, fetchPage, queryClient],
  );

  const retry = useCallback<LoadDiffPatchPath>(
    (path) => {
      setInFlight((previous) => clearError(previous, path));
      loadPathNow(path);
    },
    [loadPathNow],
  );

  const loadPath = useCallback<LoadDiffPatchPath>(
    (path) => {
      if (readDiffPatchEntry(queryClient, identity, path) !== undefined) return;
      if (
        isLoadingForCurrentGeneration(
          inFlightRef.current.loading,
          path,
          getDiffPatchEvictionGeneration(queryClient, environmentId),
        ) ||
        inFlightRef.current.errors.has(path)
      ) {
        return;
      }
      loadPathNow(path);
    },
    [environmentId, identity, loadPathNow, queryClient],
  );

  const getPatchState = useCallback<GetDiffPatchState>(
    (path) =>
      resolvePatchState({
        cached: readDiffPatchEntry(queryClient, identity, path),
        inFlight,
        path,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheVersion invalidates the cache reads
    [cacheVersion, identity, inFlight, queryClient],
  );

  const seedInitialPatches = useCallback(
    (entries: readonly DiffPatchEntry[]) => {
      if (entries.length === 0) return;
      for (const entry of entries) {
        writeDiffPatchEntry(queryClient, identity, entry);
      }
      setCacheVersion((version) => version + 1);
    },
    [identity, queryClient],
  );

  return { requestPaths, getPatchState, retry, loadPath, seedInitialPatches };
}
