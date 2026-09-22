// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { sdk } from "@/lib/sdk";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  useMarkThreadRead,
  useMarkThreadUnread,
} from "./mutations/thread-state-mutations";
import { sidebarNavigationQueryKey } from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { markRead: vi.fn(), markUnread: vi.fn() } },
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it.each(
  (["read", "unread"] as const).flatMap((mode) =>
    [false, true].flatMap((fails) =>
      [false, true].map((refreshing) => ({ mode, fails, refreshing })),
    ),
  ),
)(
  "preserves sidebar refreshes when marking $mode (fails=$fails, refreshing=$refreshing)",
  async ({ mode, fails, refreshing }) => {
    const harness = createQueryClientTestHarness();
    const parent = makeThreadListEntry({
      id: "parent",
      projectId: "project",
      lastReadAt: null,
    });
    const child = makeThreadListEntry({
      id: "child",
      projectId: "project",
      parentThreadId: parent.id,
    });
    const bootstrap = (threads: (typeof parent)[]) =>
      makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({ id: "project", threads })],
      });
    harness.queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      bootstrap([parent]),
    );
    const signals: AbortSignal[] = [];
    const fetchSidebar = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return signals.length === 1
        ? new Promise<ReturnType<typeof bootstrap>>(() => {})
        : Promise.resolve(bootstrap([parent, child]));
    });
    vi.mocked(sdk.threads.markRead).mockResolvedValue(
      makeThreadResponse({ id: parent.id, projectId: parent.projectId }),
    );
    vi.mocked(sdk.threads.markUnread).mockResolvedValue(
      makeThreadResponse({
        id: parent.id,
        projectId: parent.projectId,
        lastReadAt: null,
      }),
    );
    const failure = new Error("Read state request failed");
    if (fails) {
      vi.mocked(sdk.threads.markRead).mockRejectedValue(failure);
      vi.mocked(sdk.threads.markUnread).mockRejectedValue(failure);
    }
    const { result } = renderHook(
      () => {
        const sidebar = useQuery({
          queryKey: sidebarNavigationQueryKey(),
          queryFn: fetchSidebar,
          staleTime: Infinity,
        });
        const read = useMarkThreadRead();
        const unread = useMarkThreadUnread();
        return { sidebar, mutation: mode === "read" ? read : unread };
      },
      { wrapper: harness.wrapper },
    );
    const effects = createRealtimeCacheEffects({
      queryClient: harness.queryClient,
    });
    try {
      if (refreshing) {
        act(() =>
          effects.handleChanged({
            type: "changed",
            entity: "thread",
            id: child.id,
            changes: ["thread-created"],
            metadata: { projectId: parent.projectId },
          }),
        );
        await waitFor(() => expect(fetchSidebar).toHaveBeenCalledTimes(1));
      }
      await act(async () => {
        const mutation = result.current.mutation.mutateAsync({
          threadId: parent.id,
        });
        if (fails) await expect(mutation).rejects.toBe(failure);
        else await mutation;
      });
      if (refreshing) expect(signals[0]?.aborted).toBe(true);
      await waitFor(() =>
        expect(
          result.current.sidebar.data?.projects[0]?.threads.map(
            (thread) => thread.id,
          ),
        ).toEqual(refreshing ? [parent.id, child.id] : [parent.id]),
      );
      expect(fetchSidebar).toHaveBeenCalledTimes(refreshing ? 2 : 0);
    } finally {
      effects.dispose();
      harness.queryClient.clear();
    }
  },
);
