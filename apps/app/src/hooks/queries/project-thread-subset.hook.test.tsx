// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadListQueryKey } from "./query-keys";
import { useProjectThreadSubset } from "./thread-queries";

const PROJECT_LIST_KEY = threadListQueryKey({
  archived: false,
  projectId: "proj_one",
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProjectThreadSubset", () => {
  it("refreshes the project list it derives from once that list is cached after mount", async () => {
    const child = makeThreadListEntry({
      id: "thr_child",
      projectId: "proj_one",
      parentThreadId: "thr_parent",
    });
    const list = vi.spyOn(sdk.threads, "list").mockResolvedValue([child]);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useProjectThreadSubset({
          filters: { parentThreadId: "thr_parent" },
          projectId: "proj_one",
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual([child]);
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).toMatchObject({
      parentThreadId: "thr_parent",
    });

    await act(async () => {
      queryClient.setQueryData(PROJECT_LIST_KEY, [child]);
    });
    list.mockClear();
    await act(async () => {
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: PROJECT_LIST_KEY,
      });
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]?.[0]).not.toHaveProperty("parentThreadId");
  });
});
