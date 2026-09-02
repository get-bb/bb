// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";
import { ThreadSectionMoveProvider } from "./ThreadSectionMoveProvider";

const moveThreadToSection = vi.hoisted(() => vi.fn());
const copyToClipboardWithToast = vi.hoisted(() => vi.fn());
const threadActions = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast,
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMoveThreadToSection: () => moveThreadToSection,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    ...threadActions,
    renameThread: vi.fn(),
  }),
}));

const destinations = [
  { label: "Planning", sectionId: "sec_planning" },
  { label: "Building", sectionId: "sec_building" },
  { label: "Threads", sectionId: null },
] as const;
const thread = makeThreadListEntry({
  id: "thread-1",
  pinnedAt: null,
  sectionId: "sec_planning",
  title: "Move me",
});

function renderWide(children: ReactNode, withMoveProvider = true) {
  const content = withMoveProvider ? (
    <ThreadSectionMoveProvider destinations={destinations}>
      {children}
    </ThreadSectionMoveProvider>
  ) : (
    children
  );
  return render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      {content}
    </CompactViewportOverrideProvider>,
  );
}

function renderCompact(children: ReactNode) {
  return render(
    <CompactViewportOverrideProvider isCompactViewport>
      <ThreadSectionMoveProvider destinations={destinations}>
        {children}
      </ThreadSectionMoveProvider>
    </CompactViewportOverrideProvider>,
  );
}

async function openMoveSubmenu() {
  const trigger = await screen.findByRole("menuitem", {
    name: "Move to section",
  });
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
  return screen.findByRole("menuitem", { name: "Building" });
}

afterEach(() => {
  cleanup();
  moveThreadToSection.mockReset();
  copyToClipboardWithToast.mockReset();
  for (const action of Object.values(threadActions)) {
    action.mockReset();
  }
});

describe("ThreadActionsMenu", () => {
  it("copies the canonical thread URL from every menu instance", () => {
    renderWide(<ThreadActionsMenu thread={thread} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread link" }));

    expect(copyToClipboardWithToast).toHaveBeenCalledWith(
      `${window.location.origin}/projects/${thread.projectId}/threads/${thread.id}`,
      {
        successMessage: "Thread link copied",
        errorMessage: "Failed to copy thread link",
      },
    );
  });
});

describe("ThreadActionsMenu section moves", () => {
  it("moves from the overflow menu and indicates the current section", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    const building = await openMoveSubmenu();
    const current = screen.getByRole("menuitem", { name: "Planning" });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(building);
    expect(moveThreadToSection).toHaveBeenCalledWith({
      thread,
      sectionId: "sec_building",
    });
  });

  it("offers the same destinations from the thread context menu", async () => {
    renderWide(
      <ThreadActionsContextMenu thread={thread}>
        <div data-testid="thread-row">Move me</div>
      </ThreadActionsContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId("thread-row"));
    const building = await openMoveSubmenu();
    fireEvent.click(building);

    expect(moveThreadToSection).toHaveBeenCalledWith({
      thread,
      sectionId: "sec_building",
    });
  });

  it("does not add section controls outside Manual organization", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />, false);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "Move to section" }),
    ).toBeNull();
  });

  it("does not offer section moves for nested child threads", async () => {
    const childThread = makeThreadListEntry({
      ...thread,
      id: "thread-child",
      parentThreadId: thread.id,
    });
    renderWide(<ThreadActionsMenu thread={childThread} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "Move to section" }),
    ).toBeNull();
  });

  it("uses a reversible destination step in the compact actions drawer", async () => {
    renderCompact(<ThreadActionsMenu thread={thread} />);

    fireEvent.click(screen.getByRole("button", { name: "Thread actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to section" }),
    );

    expect(await screen.findByText("Move to section")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Building" })).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    expect(
      await screen.findByRole("menuitem", { name: "Rename" }),
    ).not.toBeNull();
  });

  it("reopens the compact overflow menu at the root after moving a thread", async () => {
    renderCompact(<ThreadActionsMenu thread={thread} />);

    const trigger = screen.getByRole("button", { name: "Thread actions" });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to section" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Building" }));

    fireEvent.click(trigger);
    expect(
      await screen.findByRole("menuitem", { name: "Move to section" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
  });

  it("reopens the compact long-press menu at the root after moving a thread", async () => {
    renderCompact(
      <ThreadActionsContextMenu thread={thread}>
        <div data-testid="thread-row">Move me</div>
      </ThreadActionsContextMenu>,
    );

    const row = screen.getByTestId("thread-row");
    fireEvent.contextMenu(row);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move to section" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Building" }));

    fireEvent.contextMenu(row);
    expect(
      await screen.findByRole("menuitem", { name: "Move to section" }),
    ).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
  });
});
