// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type {
  DiffPatchEntry,
  EnvironmentDiffPatchResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { removeEnvironmentDiffPatchQueries } from "../cache-owners/query-cache";
import { bumpAllDiffPatchEvictionGenerations } from "../cache-owners/environment-diff-patch-cache-owner";
import { environmentDiffPatchQueryKey } from "./query-keys";
import { useEnvironmentDiffPatches } from "./use-environment-diff-patches";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getEnvironmentDiffPatches: vi.fn(),
  };
});

const ENVIRONMENT_ID = "env-1";
const TARGET: WorkspaceDiffTarget = { type: "all", mergeBaseBranch: "main" };
const PATH = "file.ts";

function patchKey() {
  return environmentDiffPatchQueryKey(ENVIRONMENT_ID, "all", "main", PATH);
}

function availableResponse(entry: DiffPatchEntry): EnvironmentDiffPatchResponse {
  return { outcome: "available", patches: [entry] };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(api.getEnvironmentDiffPatches).mockReset();
});

describe("useEnvironmentDiffPatches", () => {
  it("aborts in-flight patch fetches when the target changes", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const changedTarget: WorkspaceDiffTarget = {
      type: "branch_committed",
      mergeBaseBranch: "main",
    };
    const firstFetch = deferred<EnvironmentDiffPatchResponse>();
    vi.mocked(api.getEnvironmentDiffPatches).mockReturnValue(
      firstFetch.promise,
    );

    const { result, rerender } = renderHook(
      ({ target }) => useEnvironmentDiffPatches(ENVIRONMENT_ID, { target }),
      { wrapper, initialProps: { target: TARGET as WorkspaceDiffTarget } },
    );

    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });

    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(1);
    });
    const request = vi.mocked(api.getEnvironmentDiffPatches).mock.calls[0]?.[1];
    expect(request?.signal?.aborted).toBe(false);

    rerender({ target: changedTarget });

    expect(request?.signal?.aborted).toBe(true);
    expect(result.current.getPatchState(PATH).status).toBe("idle");
  });

  it("drops a patch fetch that resolves after a mid-flight eviction and re-fetches fresh", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();

    const stalePatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+stale\n",
      truncated: false,
    };
    const freshPatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+fresh\n",
      truncated: false,
    };

    // First fetch hangs until we resolve it by hand, so we can evict mid-flight.
    const firstFetch = deferred<EnvironmentDiffPatchResponse>();
    vi.mocked(api.getEnvironmentDiffPatches)
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce(availableResponse(freshPatch));

    const { result } = renderHook(
      () => useEnvironmentDiffPatches(ENVIRONMENT_ID, { target: TARGET }),
      { wrapper },
    );

    // Panel reports the path; the debounced dispatch fires the in-flight fetch.
    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.getPatchState(PATH).status).toBe("loading");
    });

    // The file is edited: the realtime path evicts the env's patch cache (and
    // bumps the eviction generation) while the original fetch is still pending.
    act(() => {
      removeEnvironmentDiffPatchQueries({
        environmentId: ENVIRONMENT_ID,
        queryClient,
      });
    });

    // The pre-edit fetch now resolves with STALE content.
    await act(async () => {
      firstFetch.resolve(availableResponse(stalePatch));
      await firstFetch.promise;
    });

    // The stale write was dropped: nothing is cached under the patch key, and
    // the path is released from `loading` so it is eligible to be re-requested.
    await waitFor(() => {
      expect(result.current.getPatchState(PATH).status).toBe("idle");
    });
    expect(queryClient.getQueryData(patchKey())).toBeUndefined();

    // The panel re-fires `requestPaths` (driven by the TOC refetch); this time
    // the fetch lands fresh content into the cache.
    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const state = result.current.getPatchState(PATH);
      expect(state.status).toBe("loaded");
      expect(state.patch).toBe(freshPatch.patch);
    });
    expect(queryClient.getQueryData<DiffPatchEntry>(patchKey())).toEqual(
      freshPatch,
    );
  });

  it("starts a fresh fetch when a visible path is re-requested after eviction while an older fetch is still loading", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();

    const stalePatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+stale\n",
      truncated: false,
    };
    const freshPatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+fresh\n",
      truncated: false,
    };

    const firstFetch = deferred<EnvironmentDiffPatchResponse>();
    vi.mocked(api.getEnvironmentDiffPatches)
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce(availableResponse(freshPatch));

    const { result } = renderHook(
      () => useEnvironmentDiffPatches(ENVIRONMENT_ID, { target: TARGET }),
      { wrapper },
    );

    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.getPatchState(PATH).status).toBe("loading");
    });

    act(() => {
      removeEnvironmentDiffPatchQueries({
        environmentId: ENVIRONMENT_ID,
        queryClient,
      });
    });

    // The TOC refetch can report the same visible path before the stale request
    // resolves. That must start a second fetch instead of being deduped against
    // the pre-eviction loading entry.
    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const state = result.current.getPatchState(PATH);
      expect(state.status).toBe("loaded");
      expect(state.patch).toBe(freshPatch.patch);
    });

    await act(async () => {
      firstFetch.resolve(availableResponse(stalePatch));
      await firstFetch.promise;
    });

    expect(result.current.getPatchState(PATH)).toMatchObject({
      status: "loaded",
      patch: freshPatch.patch,
    });
    expect(queryClient.getQueryData<DiffPatchEntry>(patchKey())).toEqual(
      freshPatch,
    );
  });

  it("drops a fetch resolving after an all-environment (reconnect) eviction, even for a never-individually-evicted env", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();

    // A distinct env that is ONLY ever fetched here — never individually evicted
    // — so it is absent from the per-env eviction map. Reusing the shared
    // ENVIRONMENT_ID would let an earlier per-env eviction add it to the map and
    // mask the all-env (reconnect) gap this test guards.
    const RECONNECT_ENV = "env-reconnect-only";
    const reconnectKey = environmentDiffPatchQueryKey(
      RECONNECT_ENV,
      "all",
      "main",
      PATH,
    );

    const stalePatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+stale\n",
      truncated: false,
    };
    const freshPatch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+fresh\n",
      truncated: false,
    };

    const firstFetch = deferred<EnvironmentDiffPatchResponse>();
    vi.mocked(api.getEnvironmentDiffPatches)
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce(availableResponse(freshPatch));

    const { result } = renderHook(
      () => useEnvironmentDiffPatches(RECONNECT_ENV, { target: TARGET }),
      { wrapper },
    );

    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.getPatchState(PATH).status).toBe("loading");
    });

    // Server reconnect evicts EVERY environment's patch cache via the shared
    // generation bump. This env is never individually evicted, so it is absent
    // from the per-env map — the bump must still reach it.
    act(() => {
      bumpAllDiffPatchEvictionGenerations();
    });

    await act(async () => {
      firstFetch.resolve(availableResponse(stalePatch));
      await firstFetch.promise;
    });

    await waitFor(() => {
      expect(result.current.getPatchState(PATH).status).toBe("idle");
    });
    expect(queryClient.getQueryData(reconnectKey)).toBeUndefined();

    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });
    await waitFor(() => {
      expect(api.getEnvironmentDiffPatches).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const state = result.current.getPatchState(PATH);
      expect(state.status).toBe("loaded");
      expect(state.patch).toBe(freshPatch.patch);
    });
  });

  it("caches a patch fetch that resolves with no intervening eviction", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();

    const patch: DiffPatchEntry = {
      path: PATH,
      patch: "diff --git a/file.ts b/file.ts\n+content\n",
      truncated: false,
    };
    vi.mocked(api.getEnvironmentDiffPatches).mockResolvedValue(
      availableResponse(patch),
    );

    const { result } = renderHook(
      () => useEnvironmentDiffPatches(ENVIRONMENT_ID, { target: TARGET }),
      { wrapper },
    );

    act(() => {
      result.current.requestPaths({ visible: [PATH], overscan: [] });
    });

    await waitFor(() => {
      const state = result.current.getPatchState(PATH);
      expect(state.status).toBe("loaded");
      expect(state.patch).toBe(patch.patch);
    });
    expect(queryClient.getQueryData<DiffPatchEntry>(patchKey())).toEqual(patch);
  });
});
