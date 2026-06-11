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
