// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadArchiveQuickAction } from "./ThreadActionsMenu";

const mocks = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: mocks.archiveThreadAndChildren,
    unarchiveThread: mocks.unarchiveThread,
  }),
}));

function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    archivedAt: null,
    ...overrides,
  } as Thread;
}

afterEach(() => {
  cleanup();
  mocks.archiveThreadAndChildren.mockReset();
  mocks.unarchiveThread.mockReset();
});

describe("ThreadArchiveQuickAction", () => {
  it("archives the thread on one click without bubbling to the row", () => {
    const onRowClick = vi.fn();
    const thread = createThread();
    render(
      <TooltipProvider>
        <div onClick={onRowClick}>
          <ThreadArchiveQuickAction thread={thread} />
        </div>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive thread" }));

    expect(mocks.archiveThreadAndChildren).toHaveBeenCalledWith(thread);
    expect(mocks.unarchiveThread).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("unarchives an archived thread instead", () => {
    const thread = createThread({ archivedAt: 5 });
    render(
      <TooltipProvider>
        <ThreadArchiveQuickAction thread={thread} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unarchive thread" }));

    expect(mocks.unarchiveThread).toHaveBeenCalledWith(thread);
    expect(mocks.archiveThreadAndChildren).not.toHaveBeenCalled();
  });
});
