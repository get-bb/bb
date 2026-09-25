// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { ReactNode } from "react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "@/components/sidebar/sidebarCollapsedAtoms";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import {
  AppThreadSectionMoveProvider,
  ThreadSectionMoveProvider,
} from "./ThreadSectionMoveProvider";
import { useSidebarRename } from "../sidebar/SidebarInlineRename";

const moveThreadToSection = vi.hoisted(() => vi.fn());
const copyToClipboardWithToast = vi.hoisted(() => vi.fn());
const threadActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
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
  useThreadActions: () => threadActions,
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

function InlineRenameMenuHarness() {
  const rename = useSidebarRename({
    kind: "thread",
    id: thread.id,
    name: thread.title ?? "Thread",
    label: "Thread name",
    onSave: async () => {},
  });
  return (
    <div data-sidebar-rename-row="" data-testid="thread-row">
      <button type="button" data-sidebar-rename-anchor="">
        Open thread
      </button>
      {rename.editor ?? <span>{thread.title}</span>}
      <ThreadActionsMenu
        thread={thread}
        onRename={rename.startEditingFromMenu}
        onCloseAutoFocus={rename.onCloseAutoFocus}
      />
    </div>
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
  it("keeps the existing rename dialog for callers without an inline override", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(threadActions.requestRename).toHaveBeenCalledWith(thread);
    });
  });

  it.each([{ compact: false }, { compact: true }])(
    "hands focus to inline rename ($compact)",
    async ({ compact }) => {
      (compact ? renderCompact : renderWide)(<InlineRenameMenuHarness />);
      const trigger = screen.getByRole("button", { name: "Thread actions" });
      if (compact) fireEvent.click(trigger);
      else fireEvent.pointerDown(trigger, { button: 0 });
      const item = await screen.findByRole("menuitem", { name: "Rename" });
      if (compact) fireEvent.click(item);
      else fireEvent.keyDown(item, { key: "Enter" });
      const input = await screen.findByRole("textbox", { name: "Thread name" });
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(input).toHaveProperty("value", "Move me");
      expect(threadActions.requestRename).not.toHaveBeenCalled();
    },
  );

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
  it("keeps hidden sections selectable without restoring them to the list", async () => {
    const store = createStore();
    const hidden = ["section:sec_planning", "section:sec_building"];
    const order = [
      "section:sec_building",
      "pinned",
      "threads",
      "section:sec_planning",
    ];
    store.set(sidebarOrganizationModeAtom, "chronological");
    store.set(sidebarHiddenGroupsAtom, hidden);
    store.set(sidebarManualSectionOrderAtom, order);
    const unfiledThread = makeThreadListEntry({
      ...thread,
      parentThreadId: null,
      sectionId: null,
    });
    renderWide(
      <Provider store={store}>
        <AppThreadSectionMoveProvider
          sections={[
            { id: "sec_planning", name: "Planning" },
            { id: "sec_building", name: "Building" },
          ]}
        >
          <ThreadActionsMenu thread={unfiledThread} />
        </AppThreadSectionMoveProvider>
      </Provider>,
      false,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    const building = await openMoveSubmenu();
    expect(screen.getByRole("menuitem", { name: "Planning" })).not.toBeNull();
    fireEvent.click(building);

    expect(moveThreadToSection).toHaveBeenCalledWith({
      thread: unfiledThread,
      sectionId: "sec_building",
    });
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(hidden);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(order);
  });

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

  it("supports Back and resets the compact overflow menu after a move", async () => {
    renderCompact(<ThreadActionsMenu thread={thread} />);

    const trigger = screen.getByRole("button", { name: "Thread actions" });
    fireEvent.click(trigger);
    const moveToSection = await screen.findByRole("menuitem", {
      name: "Move to section",
    });
    expect(
      moveToSection.querySelector('[data-icon="SectionMove"]'),
    ).not.toBeNull();
    fireEvent.click(moveToSection);

    expect(await screen.findByText("Move to section")).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Building" })).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    expect(
      await screen.findByRole("menuitem", { name: "Rename" }),
    ).not.toBeNull();

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
});
