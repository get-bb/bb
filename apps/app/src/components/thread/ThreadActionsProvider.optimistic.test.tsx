// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { Thread, ThreadListEntry } from "@bb/domain";
import type { ThreadArchiveAllResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { restoreClosedPanesAtom } from "@/lib/split-layout/atoms";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

const mocks = vi.hoisted(() => ({
  closePanesForThreads: vi.fn(),
  restoreClosedPanes: vi.fn(),
  navigate: vi.fn(),
  pathname: "/",
  viewedThreadId: undefined as string | undefined,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useLocation: () => ({ hash: "", pathname: mocks.pathname, search: "" }),
  };
});

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => mocks.navigate,
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useSetAtom: (atom: unknown) =>
      atom === restoreClosedPanesAtom
        ? mocks.restoreClosedPanes
        : mocks.closePanesForThreads,
  };
});

vi.mock("@/components/dialogs/ThreadRenameDialog", () => ({
  ThreadRenameDialog: () => null,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      archiveAll: vi.fn(),
      childSummary: vi.fn(),
      delete: vi.fn(),
      unarchive: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: mocks.viewedThreadId }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function makeEntry(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    createdAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    projectId: "project-1",
    title: "Archive target",
    titleFallback: null,
    updatedAt: 1,
    ...overrides,
  });
}

function seedSidebar(threads: ThreadListEntry[]) {
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          id: "project-1",
          name: "Project",
          createdAt: 1,
          updatedAt: 1,
          threads,
        }),
      ],
    }),
  );
}

function ActionButtons({ thread }: { thread: Thread }) {
  const { requestArchive, requestDelete } = useThreadActions();
  return (
    <>
      <button type="button" onClick={() => requestArchive(thread)}>
        Archive
      </button>
      <button type="button" onClick={() => requestDelete(thread)}>
        Delete…
      </button>
    </>
  );
}

function DeleteThenArchiveButtons({
  archiveThread,
  deleteThread,
}: {
  archiveThread: Thread;
  deleteThread: Thread;
}) {
  const { requestArchive, requestDelete } = useThreadActions();
  return (
    <>
      <button type="button" onClick={() => requestDelete(deleteThread)}>
        Delete…
      </button>
      <button type="button" onClick={() => requestArchive(archiveThread)}>
        Archive other
      </button>
    </>
  );
}

function abortableChildSummary({ signal }: { signal?: AbortSignal }) {
  return new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function renderProvider(children: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThreadActionsProvider>{children}</ThreadActionsProvider>
    </QueryClientProvider>,
  );
}

function lastArchiveToastOptions() {
  const options = vi.mocked(appToast.success).mock.calls.at(-1)?.[1];
  if (options === undefined) {
    throw new Error("Expected an archive toast");
  }
  return options;
}

function runUndo() {
  const undo = lastArchiveToastOptions().cancel;
  if (undo === undefined) {
    throw new Error("Expected archive toast to provide Undo");
  }
  undo.onClick(
    new MouseEvent("click") as unknown as Parameters<typeof undo.onClick>[0],
  );
}

let queryClient: QueryClient;
const parent = makeEntry({ id: "thr_parent" });
const threadRoute = "/projects/project-1/threads/thr_parent";

beforeEach(() => {
  mocks.pathname = threadRoute;
  mocks.viewedThreadId = "thr_parent";
  queryClient = createQueryClientTestHarness().queryClient;
  vi.mocked(sdk.threads.childSummary).mockResolvedValue({
    nonDeletedChildCount: 0,
    unarchivedDescendantCount: 0,
  });
  vi.mocked(sdk.threads.unarchive).mockResolvedValue({ ok: true });
  mocks.closePanesForThreads.mockReturnValue({
    focusedRoute: null,
    removedAny: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadActionsProvider optimistic archive", () => {
  it("navigates and toasts before the archive request resolves for a cached childless thread", async () => {
    seedSidebar([parent]);
    const archive = deferred<ThreadArchiveAllResponse>();
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(archive.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(sdk.threads.childSummary).not.toHaveBeenCalled();
    expect(mocks.closePanesForThreads).toHaveBeenCalledWith(["thr_parent"]);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    expect(appToast.success).toHaveBeenCalledTimes(1);
    expect(lastArchiveToastOptions()).toMatchObject({
      id: "thread-archived-thr_parent",
    });
    await vi.waitFor(() => {
      expect(sdk.threads.archiveAll).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the confirmation synchronously for a cached thread with live children", () => {
    seedSidebar([
      parent,
      makeEntry({ id: "thr_child_a", parentThreadId: "thr_parent" }),
      makeEntry({ id: "thr_child_b", parentThreadId: "thr_parent" }),
    ]);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(
      screen.getByText(/2 child threads will be archived with this thread\./),
    ).not.toBeNull();
    expect(sdk.threads.childSummary).not.toHaveBeenCalled();
    expect(sdk.threads.archiveAll).not.toHaveBeenCalled();
  });

  it("asks the server about children for a thread outside the sidebar cache", async () => {
    vi.mocked(sdk.threads.childSummary).mockResolvedValue({
      nonDeletedChildCount: 0,
      unarchivedDescendantCount: 0,
    });
    vi.mocked(sdk.threads.archiveAll).mockResolvedValue({
      archivedThreadIds: ["thr_parent"],
      ok: true,
    });
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await vi.waitFor(() => {
      expect(sdk.threads.childSummary).toHaveBeenCalledTimes(1);
      expect(sdk.threads.archiveAll).toHaveBeenCalledWith({
        threadId: "thr_parent",
      });
    });
  });

  it("dismisses the toast and returns to the thread when the archive fails", async () => {
    seedSidebar([parent]);
    const archive = deferred<ThreadArchiveAllResponse>();
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(archive.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith("/");

    await act(async () => {
      archive.reject(new Error("offline"));
      await archive.promise.catch(() => {});
    });

    await vi.waitFor(() => {
      expect(appToast.dismiss).toHaveBeenCalledWith(
        "thread-archived-thr_parent",
      );
    });
    expect(mocks.navigate).toHaveBeenLastCalledWith(threadRoute);
    expect(mocks.restoreClosedPanes).toHaveBeenCalledWith({
      focusedRoute: null,
      removedAny: false,
    });
    expect(
      queryClient
        .getQueryData<{ projects: { threads: ThreadListEntry[] }[] }>(
          sidebarNavigationQueryKey(),
        )
        ?.projects[0]?.threads.map((thread) => thread.id),
    ).toEqual(["thr_parent"]);
  });

  it("corrects the toast count and undoes every thread the server archived", async () => {
    seedSidebar([parent]);
    const archive = deferred<ThreadArchiveAllResponse>();
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(archive.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await act(async () => {
      archive.resolve({
        archivedThreadIds: ["thr_remote_child", "thr_parent"],
        ok: true,
      });
      await archive.promise;
    });

    await vi.waitFor(() => {
      expect(appToast.success).toHaveBeenCalledTimes(2);
    });
    expect(mocks.closePanesForThreads).toHaveBeenLastCalledWith([
      "thr_remote_child",
    ]);
    runUndo();

    await vi.waitFor(() => {
      expect(sdk.threads.unarchive).toHaveBeenCalledTimes(2);
    });
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(1, {
      threadId: "thr_parent",
    });
    expect(sdk.threads.unarchive).toHaveBeenNthCalledWith(2, {
      threadId: "thr_remote_child",
    });
  });

  it("defers an early Undo until the archive request settles", async () => {
    seedSidebar([parent]);
    const archive = deferred<ThreadArchiveAllResponse>();
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(archive.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    runUndo();

    expect(mocks.navigate).toHaveBeenLastCalledWith(threadRoute);
    expect(mocks.restoreClosedPanes).toHaveBeenCalledTimes(1);
    expect(sdk.threads.unarchive).not.toHaveBeenCalled();

    await act(async () => {
      archive.resolve({ archivedThreadIds: ["thr_parent"], ok: true });
      await archive.promise;
    });

    await vi.waitFor(() => {
      expect(sdk.threads.unarchive).toHaveBeenCalledWith({
        threadId: "thr_parent",
      });
    });
  });
});

describe("ThreadActionsProvider optimistic delete", () => {
  it("opens the dialog at once and enables confirm after the child check", async () => {
    seedSidebar([parent]);
    const summary = deferred<{
      nonDeletedChildCount: number;
      unarchivedDescendantCount: number;
    }>();
    vi.mocked(sdk.threads.childSummary).mockReturnValue(summary.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));

    const confirm = screen.getByRole("button", { name: "Delete thread" });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      summary.resolve({ nonDeletedChildCount: 1, unarchivedDescendantCount: 0 });
      await summary.promise;
    });

    expect(
      screen
        .getByRole("button", { name: "Delete thread" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.getByText(/Child threads will be deleted\./)).not.toBeNull();
  });

  it("closes the dialog and navigates before the delete request resolves", async () => {
    seedSidebar([
      parent,
      makeEntry({ id: "thr_child", parentThreadId: "thr_parent" }),
    ]);
    vi.mocked(sdk.threads.childSummary).mockReturnValue(
      deferred<never>().promise,
    );
    const deletion = deferred<{ ok: true }>();
    vi.mocked(sdk.threads.delete).mockReturnValue(deletion.promise);
    renderProvider(<ActionButtons thread={parent} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete thread" }));

    expect(screen.queryByRole("button", { name: "Delete thread" })).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith("/");
    await vi.waitFor(() => {
      expect(sdk.threads.delete).toHaveBeenCalledWith({
        childThreadsConfirmed: true,
        threadId: "thr_parent",
      });
    });

    await act(async () => {
      deletion.reject(new Error("offline"));
      await deletion.promise.catch(() => {});
    });
    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenLastCalledWith(threadRoute);
    });
    expect(mocks.restoreClosedPanes).toHaveBeenCalledTimes(1);
  });

  it("closes a pending dialog when another thread action aborts its child check", async () => {
    const other = makeEntry({ id: "thr_other" });
    seedSidebar([parent, other]);
    vi.mocked(sdk.threads.childSummary).mockImplementation(
      abortableChildSummary,
    );
    vi.mocked(sdk.threads.archiveAll).mockReturnValue(
      deferred<ThreadArchiveAllResponse>().promise,
    );
    renderProvider(
      <DeleteThenArchiveButtons archiveThread={other} deleteThread={parent} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete…" }));
    expect(
      screen
        .getByRole("button", { name: "Delete thread" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Archive other", hidden: true }),
      );
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Delete thread" }),
      ).toBeNull();
    });
  });
});
