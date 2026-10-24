import { QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { BbHttpError } from "@bb/sdk/browser";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { bindSdkToPlugin } from "@/lib/plugin-bound-sdk";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { runThreadReadStateCommand } from "./mutations/thread-state-mutations";
import { sidebarNavigationQueryKey } from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { markRead: vi.fn(), markUnread: vi.fn() } },
}));

afterEach(() => {
  vi.resetAllMocks();
});

it.each(
  (["core", "plugin"] as const).flatMap((surface) =>
    (["read", "unread"] as const).flatMap((mode) =>
      [false, true].flatMap((fails) =>
        [false, true].map((refreshing) => ({
          surface,
          mode,
          fails,
          refreshing,
        })),
      ),
    ),
  ),
)(
  "preserves sidebar refreshes through $surface when marking $mode (fails=$fails, refreshing=$refreshing)",
  async ({ surface, mode, fails, refreshing }) => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false },
      },
      showMutationErrorToasts: false,
    });
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
    queryClient.setQueryData(sidebarNavigationQueryKey(), bootstrap([parent]));
    const serverThreads = refreshing ? [parent, child] : [parent];
    const signals: AbortSignal[] = [];
    const pendingFetches: (() => void)[] = [];
    const fetchSidebar = vi.fn(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<ReturnType<typeof bootstrap>>((resolve) => {
          signals.push(signal);
          pendingFetches.push(() => resolve(bootstrap(serverThreads)));
        }),
    );
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
    const failure = new BbHttpError({
      body: null,
      code: null,
      message: "Read state request failed",
      status: 400,
    });
    if (fails) {
      vi.mocked(sdk.threads.markRead).mockRejectedValue(failure);
      vi.mocked(sdk.threads.markUnread).mockRejectedValue(failure);
    }
    const sidebar = new QueryObserver(queryClient, {
      queryKey: sidebarNavigationQueryKey(),
      queryFn: fetchSidebar,
      staleTime: Infinity,
    });
    const unsubscribe = sidebar.subscribe(() => {});
    const effects = createRealtimeCacheEffects({ queryClient });
    try {
      if (refreshing) {
        effects.handleChanged({
          type: "changed",
          entity: "thread",
          id: child.id,
          changes: ["thread-created"],
          metadata: { projectId: parent.projectId },
        });
        await vi.waitFor(() => expect(fetchSidebar).toHaveBeenCalledTimes(1));
      }
      const bound = bindSdkToPlugin(sdk, "test", queryClient);
      const marking =
        surface === "core"
          ? runThreadReadStateCommand(queryClient, {
              kind: mode,
              threadId: parent.id,
            })
          : mode === "read"
            ? bound.threads.markRead({ threadId: parent.id })
            : bound.threads.markUnread({ threadId: parent.id });
      if (fails) await expect(marking).rejects.toBe(failure);
      else await marking;
      const expectedFetches = Number(refreshing) + Number(fails);
      for (let call = 1; call <= expectedFetches; call += 1) {
        await vi.waitFor(() =>
          expect(fetchSidebar).toHaveBeenCalledTimes(call),
        );
        pendingFetches[call - 1]?.();
      }
      await vi.waitFor(() =>
        expect(
          sidebar
            .getCurrentResult()
            .data?.projects[0]?.threads.map((thread) => thread.id),
        ).toEqual(serverThreads.map((thread) => thread.id)),
      );
      expect(fetchSidebar).toHaveBeenCalledTimes(expectedFetches);
      expect(signals.some((signal) => signal.aborted)).toBe(false);
    } finally {
      effects.dispose();
      unsubscribe();
      queryClient.clear();
    }
  },
);
