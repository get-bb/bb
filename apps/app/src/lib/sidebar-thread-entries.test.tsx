// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
} from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeSidebarBootstrapResponse,
  makeProjectWithThreadsResponse,
} from "@/test/fixtures/projects";
import {
  resetSidebarBootstrapCacheForTest,
  writeCachedSidebarBootstrap,
} from "./sidebar-bootstrap-cache";
import { useSidebarThreadEntry } from "./sidebar-thread-entries";

afterEach(() => {
  cleanup();
  resetSidebarBootstrapCacheForTest();
});

function navigation(threads: ThreadListEntry[]) {
  return makeSidebarBootstrapResponse({
    projects: [makeProjectWithThreadsResponse({ threads })],
  });
}

function Entry({
  threadId,
  rendered,
}: {
  threadId: string;
  rendered?: string[];
}) {
  const entry = useSidebarThreadEntry(threadId);
  rendered?.push(threadId);
  return <span data-testid={threadId}>{entry?.title ?? "missing"}</span>;
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
    render(
      <>
        <Entry threadId={active.id} />
        <Entry threadId={archived.id} />
        <Entry threadId="thr_missing" />
      </>,
      { wrapper },
    );
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

  it("re-renders only the consumers of the thread that changed", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const threads = Array.from({ length: 50 }, (_, index) =>
      makeThreadListEntry({ id: `thr_${index}`, title: `Thread ${index}` }),
    );
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation(threads));
    const rendered: string[] = [];
    render(
      <>
        {threads.map((thread) => (
          <Entry key={thread.id} threadId={thread.id} rendered={rendered} />
        ))}
      </>,
      { wrapper },
    );

    rendered.length = 0;
    await act(async () => {
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        navigation(
          threads.map((thread) =>
            thread.id === "thr_7" ? { ...thread, title: "Renamed" } : thread,
          ),
        ),
      );
    });
    await waitFor(() =>
      expect(screen.getByTestId("thr_7").textContent).toBe("Renamed"),
    );
    expect(rendered).toEqual(["thr_7"]);
  });

  it("reads the cached bootstrap before the sidebar query has data", () => {
    const { wrapper } = createQueryClientTestHarness();
    writeCachedSidebarBootstrap(
      navigation([makeThreadListEntry({ id: "thr_cached", title: "Cached" })]),
    );
    render(<Entry threadId="thr_cached" />, { wrapper });
    expect(screen.getByTestId("thr_cached").textContent).toBe("Cached");
  });
});
