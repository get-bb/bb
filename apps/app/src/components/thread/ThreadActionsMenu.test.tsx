// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

const mocks = vi.hoisted(() => ({
  copyToClipboardWithToast: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast: mocks.copyToClipboardWithToast,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

function createThread(): Thread {
  return {
    id: "thr_test",
    archivedAt: null,
    pinnedAt: null,
  } as Thread;
}

afterEach(() => {
  cleanup();
  mocks.copyToClipboardWithToast.mockReset();
});

describe("ThreadActionsMenu", () => {
  it("copies the thread URL from the header menu", () => {
    const threadUrl =
      "https://example.getbb.app/projects/proj_test/threads/thr_test";
    render(<ThreadActionsMenu thread={createThread()} threadUrl={threadUrl} />);

    fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread link" }));

    expect(mocks.copyToClipboardWithToast).toHaveBeenCalledWith(threadUrl, {
      successMessage: "Thread link copied",
      errorMessage: "Failed to copy thread link",
    });
  });

  it("keeps the copy action out of menus without a thread URL", () => {
    render(<ThreadActionsMenu thread={createThread()} />);

    fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));

    expect(
      screen.queryByRole("menuitem", { name: "Copy thread link" }),
    ).toBeNull();
  });
});
