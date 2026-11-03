// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
} from "@/hooks/queries/query-keys";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import { useSidebarThreadEntry } from "./plugin-sidebar-hooks";
import { SidebarThreadEntriesProvider } from "./sidebar-thread-entries";

afterEach(cleanup);

function navigation(threads: ThreadListEntry[]) {
  return makeSidebarBootstrapResponse({
    projects: [makeProjectWithThreadsResponse({ threads })],
  });
}

function Entry({ threadId }: { threadId: string }) {
  const entry = useSidebarThreadEntry(threadId);
  return <span data-testid={threadId}>{entry?.title ?? "missing"}</span>;
}

function Entries({ threadIds }: { threadIds: string[] }) {
  const { data } = useSidebarNavigation({ enabled: false });
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      {threadIds.map((threadId) => (
        <Entry key={threadId} threadId={threadId} />
      ))}
    </SidebarThreadEntriesProvider>
  );
}

describe("sidebar thread entries", () => {
  it("updates active and archived titles while active entries take precedence", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const active = makeThreadListEntry({ id: "thr_active", title: "Active" });
    const archived = makeThreadListEntry({
      id: "thr_archived",
      title: "Archived",
      archivedAt: 42,
    });
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation([active]));
    queryClient.setQueryData(archivedThreadsListQueryKey({}), {
      pageParams: [0],
      pages: [
        [
          {
            ...active,
            title: "Stale archived copy",
            archivedAt: 42,
            updatedAt: active.updatedAt - 1,
          },
          archived,
        ],
      ],
    });
    render(<Entries threadIds={[active.id, archived.id, "thr_missing"]} />, {
      wrapper,
    });
    expect(screen.getByTestId(active.id).textContent).toBe("Active");
    expect(screen.getByTestId(archived.id).textContent).toBe("Archived");
    expect(screen.getByTestId("thr_missing").textContent).toBe("missing");

    await act(async () => {
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        navigation([{ ...active, title: "Renamed active" }]),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId(active.id).textContent).toBe("Renamed active"),
    );
    await act(async () => {
      queryClient.setQueryData(archivedThreadsListQueryKey({}), {
        pageParams: [0],
        pages: [[{ ...archived, title: "Renamed archive" }]],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId(archived.id).textContent).toBe(
        "Renamed archive",
      ),
    );

    await act(async () => {
      queryClient.setQueryData(sidebarNavigationQueryKey(), navigation([]));
      queryClient.setQueryData(archivedThreadsListQueryKey({}), {
        pageParams: [0],
        pages: [
          [
            {
              ...active,
              title: "Newly archived",
              archivedAt: 84,
              updatedAt: active.updatedAt + 1,
            },
          ],
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId(active.id).textContent).toBe("Newly archived"),
    );
    expect(screen.getByTestId(archived.id).textContent).toBe("missing");
  });

  it("keeps two query observers as rows grow and receives data after an empty mount", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { rerender, unmount } = render(<Entries threadIds={["thr_0"]} />, {
      wrapper,
    });
    expect(screen.getByTestId("thr_0").textContent).toBe("missing");
    const observerCount = () =>
      queryClient
        .getQueryCache()
        .getAll()
        .reduce((total, query) => total + query.getObserversCount(), 0);
    expect(observerCount()).toBe(2);
    const threads = Array.from({ length: 200 }, (_, index) =>
      makeThreadListEntry({
        id: `thr_${index}`,
        title: `Thread ${index}`,
      }),
    );
    await act(async () => {
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        navigation(threads),
      );
    });
    rerender(<Entries threadIds={threads.map((thread) => thread.id)} />);
    expect(screen.getByTestId("thr_0").textContent).toBe("Thread 0");
    expect(screen.getByTestId("thr_199").textContent).toBe("Thread 199");
    expect(observerCount()).toBe(2);
    expect(
      queryClient.getQueryState(archivedThreadsListQueryKey({}))?.fetchStatus,
    ).toBe("idle");
    unmount();
    expect(observerCount()).toBe(0);
  });
});
