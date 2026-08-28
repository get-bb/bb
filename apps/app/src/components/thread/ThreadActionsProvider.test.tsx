// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Thread } from "@bb/domain";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import {
  ThreadActionsProvider,
  useThreadActions,
} from "./ThreadActionsProvider";

const archiveAll = vi.spyOn(sdk.threads, "archiveAll");
const unarchive = vi.spyOn(sdk.threads, "unarchive");
const toastMessage = vi.spyOn(appToast, "message");
const toastSuccess = vi.spyOn(appToast, "success");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    archivedAt: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "env_test",
    id: "thr_parent",
    lastReadAt: null,
    latestAttentionAt: 1,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_test",
    providerId: "codex",
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: "Investigate archive behavior",
    titleFallback: null,
    updatedAt: 1,
    visibility: "visible",
    ...overrides,
  };
}

function ArchiveButton({ thread }: { thread: Thread }) {
  const { archiveThreadAndChildren } = useThreadActions();
  return (
    <button type="button" onClick={() => archiveThreadAndChildren(thread)}>
      Archive
    </button>
  );
}

function renderProvider(children: ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThreadActionsProvider>{children}</ThreadActionsProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  archiveAll.mockResolvedValue({
    archivedThreadIds: ["thr_parent", "thr_child"],
    ok: true,
  });
  unarchive.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadActionsProvider archive feedback", () => {
  it("shows one archive toast whose Undo restores the parent and children", async () => {
    renderProvider(<ArchiveButton thread={makeThread()} />);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await vi.waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledTimes(1);
    });
    expect(toastMessage).not.toHaveBeenCalled();
    expect(toastSuccess.mock.calls[0]?.[0]).toBe("Thread Archived");
    const toastOptions = toastSuccess.mock.calls[0]?.[1];
    expect(toastOptions).toMatchObject({
      cancel: { label: "Undo" },
      duration: 10_000,
      id: "thread-archived-thr_parent",
    });
    expect(toastOptions?.description).toBeDefined();
    expect(toastOptions?.action).toBeUndefined();

    const undoAction = toastOptions?.cancel;
    if (undoAction === undefined) {
      throw new Error("Expected archive toast to provide Undo");
    }
    render(<button onClick={undoAction.onClick}>Run undo</button>);
    fireEvent.click(screen.getByRole("button", { name: "Run undo" }));

    await vi.waitFor(() => {
      expect(unarchive).toHaveBeenCalledTimes(2);
    });
    expect(unarchive).toHaveBeenNthCalledWith(1, {
      threadId: "thr_parent",
    });
    expect(unarchive).toHaveBeenNthCalledWith(2, {
      threadId: "thr_child",
    });
  });
});
