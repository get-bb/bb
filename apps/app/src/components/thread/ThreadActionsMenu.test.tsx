// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";

const mocks = vi.hoisted(() => ({
  copyToClipboardWithToast: vi.fn(),
  requestRename: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast: mocks.copyToClipboardWithToast,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestRename: mocks.requestRename,
    requestDelete: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

function createThread(): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    archivedAt: null,
    pinnedAt: null,
  } as Thread;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadActionsMenu", () => {
  it("copies the canonical thread URL from every menu instance", () => {
    render(<ThreadActionsMenu thread={createThread()} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread link" }));

    expect(mocks.copyToClipboardWithToast).toHaveBeenCalledWith(
      `${window.location.origin}/projects/proj_test/threads/thr_test`,
      {
        successMessage: "Thread link copied",
        errorMessage: "Failed to copy thread link",
      },
    );
  });

  it("offers an explicit rename action from a thread row context menu", async () => {
    const thread = createThread();
    render(
      <ThreadActionsContextMenu thread={thread}>
        <button type="button">Test thread</button>
      </ThreadActionsContextMenu>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Test thread" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Rename thread" }),
    );

    await waitFor(() =>
      expect(mocks.requestRename).toHaveBeenCalledWith(thread),
    );
  });
});
