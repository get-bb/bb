// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { ReactNode } from "react";
import { createStore, Provider } from "jotai";
import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarOrganizationModeAtom,
} from "@/components/sidebar/sidebarCollapsedAtoms";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import {
  AppThreadSectionMoveProvider,
  ThreadSectionMoveProvider,
} from "./ThreadSectionMoveProvider";

const moveThreadToSection = vi.hoisted(() => vi.fn());
const copyToClipboardWithToast = vi.hoisted(() => vi.fn());
const getPluginMetadata = vi.hoisted(() =>
  vi.fn(async () => ({ level: "muted" })),
);
const threadActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));
const sidebarActions = vi.hoisted(() => ({
  open: vi.fn(),
  openNewThread: vi.fn(),
  setPinned: vi.fn(async () => undefined),
  setRead: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  archive: vi.fn(),
  requestDelete: vi.fn(),
}));
const split = vi.hoisted(() => ({ available: true }));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast,
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { getPluginMetadata } },
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMoveThreadToSection: () => moveThreadToSection,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => threadActions,
}));

vi.mock("@/lib/plugin-sidebar-hooks", () => ({
  useSidebarThreadActions: () => sidebarActions,
  useResolveSidebarThread: () => (id: string) => (id === thread.id ? thread : null),
}));

vi.mock("@/lib/plugin-sidebar-split", () => ({
  useSidebarThreadSplit: () => ({
    isAvailable: split.available,
    splitProps: {},
    layout: null,
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
  lastReadAt: 1,
  latestAttentionAt: 10,
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
    <QueryClientProvider client={new QueryClient()}>
      <CompactViewportOverrideProvider isCompactViewport={false}>
        {content}
      </CompactViewportOverrideProvider>
    </QueryClientProvider>,
  );
}

function renderCompact(children: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CompactViewportOverrideProvider isCompactViewport>
        <ThreadSectionMoveProvider destinations={destinations}>
          {children}
        </ThreadSectionMoveProvider>
      </CompactViewportOverrideProvider>
    </QueryClientProvider>,
  );
}

function openWide() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Thread actions" }), {
    button: 0,
  });
}

async function openSubmenu(name: string) {
  const trigger = await screen.findByRole("menuitem", { name });
  fireEvent.keyDown(trigger, { key: "ArrowRight" });
}

function menuRows(): string[] {
  return Array.from(screen.getByRole("menu").children).map((element) =>
    element.getAttribute("role") === "separator"
      ? "---"
      : (element.textContent?.trim() ?? ""),
  );
}

function registerThreadActions(
  pluginId: string,
  registrations: PluginThreadActionRegistration[],
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ threadActions: registrations }),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  split.available = true;
  moveThreadToSection.mockReset();
  copyToClipboardWithToast.mockReset();
  getPluginMetadata.mockClear();
  for (const action of Object.values(threadActions)) action.mockReset();
  for (const action of Object.values(sidebarActions)) action.mockClear();
  vi.restoreAllMocks();
});

describe("ThreadActionsMenu", () => {
  it.each([false, true])(
    "offers environment reuse only in compact menus: compact=%s",
    async (compact) => {
      const menu = (
        <ThreadActionsMenu
          thread={thread}
          environment={{ id: "env_1", path: "/repo" }}
        />
      );
      if (compact) renderCompact(menu);
      else renderWide(menu);
      const trigger = screen.getByRole("button", { name: "Thread actions" });
      if (compact) fireEvent.click(trigger);
      else fireEvent.pointerDown(trigger, { button: 0 });
      if (!compact) {
        expect(
          screen.queryByRole("menuitem", { name: "New thread in environment" }),
        ).toBeNull();
        return;
      }
      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "New thread in environment",
        }),
      );
      expect(sidebarActions.openNewThread).toHaveBeenCalledWith({
        projectId: thread.projectId,
        environmentId: "env_1",
        experimental_placement: { sectionId: "sec_planning", pinned: false },
        focusPrompt: true,
      });
    },
  );

  it("never offers Open in split for the thread already in view", () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    expect(screen.queryByRole("menuitem", { name: "Open in split" })).toBeNull();
    expect(menuRows()).toEqual([
      "Copy thread link",
      "Mark read",
      "Pin",
      "Move to section",
      "Rename",
      "---",
      "Archive",
      "Delete",
    ]);
  });

  it("opens the rename dialog from the menu", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(threadActions.requestRename).toHaveBeenCalledWith(thread);
    });
  });

  it("routes read, pin, archive, and delete through the host actions", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark read" }));
    expect(sidebarActions.setRead).toHaveBeenCalledWith(thread.id, true);
    openWide();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));
    expect(sidebarActions.setPinned).toHaveBeenCalledWith(thread.id, true);
    openWide();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() =>
      expect(sidebarActions.archive).toHaveBeenCalledWith(thread.id),
    );
    openWide();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    await waitFor(() =>
      expect(sidebarActions.requestDelete).toHaveBeenCalledWith(thread.id),
    );
  });

  it("unarchives an archived thread through the host mutation and hides Move", () => {
    const archived = makeThreadListEntry({ ...thread, archivedAt: 5 });
    renderWide(<ThreadActionsMenu thread={archived} />);
    openWide();
    expect(screen.queryByRole("menuitem", { name: "Move to section" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    expect(threadActions.unarchiveThread).toHaveBeenCalledWith(thread);
  });

  it("copies the canonical thread URL from every menu instance", () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
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

describe("ThreadActionsMenu plugin actions", () => {
  it("slots plugin actions into their groups after core, with separators between groups", async () => {
    registerThreadActions("notes", [
      {
        id: "flag",
        title: "Flag",
        resolve: () => ({ label: "Flag thread", icon: "Flag", group: "lifecycle", run() {} }),
      },
      {
        id: "star",
        title: "Star",
        resolve: () => ({ label: "Star thread", icon: "Star", group: "organize", run() {} }),
      },
    ]);
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    await screen.findByRole("menuitem", { name: "Star thread" });
    expect(menuRows()).toEqual([
      "Copy thread link",
      "Mark read",
      "Pin",
      "Move to section",
      "Rename",
      "Star thread",
      "---",
      "Archive",
      "Delete",
      "Flag thread",
    ]);
  });

  it("drops only the row whose resolve throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    registerThreadActions("notes", [
      {
        id: "broken",
        title: "Broken",
        resolve: () => {
          throw new Error("boom");
        },
      },
      {
        id: "star",
        title: "Star",
        resolve: () => ({ label: "Star thread", icon: "Star", group: "organize", run() {} }),
      },
    ]);
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    expect(await screen.findByRole("menuitem", { name: "Star thread" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename" })).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('thread action "broken" failed to resolve'),
      expect.any(Error),
    );
  });

  it("renders choices as a submenu and selects by id, with the plugin's metadata resolved", async () => {
    const select = vi.fn();
    const seen: unknown[] = [];
    registerThreadActions("notifications", [
      {
        id: "notifications",
        title: "Notifications",
        resolve: ({ metadata }) => {
          seen.push(metadata);
          return {
            label: "Notifications",
            icon: "Bell",
            group: "organize",
            choices: {
              heading: "Notifications",
              hint: "Inherited from parent",
              items: [
                { id: "all", label: "All activity" },
                { id: "muted", label: "Muted", selected: metadata?.level === "muted" },
              ],
              select,
            },
          };
        },
      },
    ]);
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    await waitFor(() => expect(seen).toContainEqual({ level: "muted" }));
    expect(getPluginMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "notifications", threadId: thread.id }),
    );
    await openSubmenu("Notifications");
    const muted = await screen.findByRole("menuitem", { name: "Muted" });
    expect(muted.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("Inherited from parent")).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "All activity" }));
    expect(select).toHaveBeenCalledWith("all");
  });

  it("shows choices as a drawer step with Back on compact", async () => {
    const select = vi.fn();
    registerThreadActions("notifications", [
      {
        id: "notifications",
        title: "Notifications",
        resolve: () => ({
          label: "Notifications",
          icon: "Bell",
          group: "organize",
          choices: {
            items: [{ id: "all", label: "All activity" }],
            select,
          },
        }),
      },
    ]);
    renderCompact(<ThreadActionsMenu thread={thread} />);
    const trigger = screen.getByRole("button", { name: "Thread actions" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Notifications" }));
    expect(await screen.findByRole("menuitem", { name: "All activity" })).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    expect(await screen.findByRole("menuitem", { name: "Rename" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Back" })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "All activity" }));
    expect(select).toHaveBeenCalledWith("all");
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

    openWide();
    await openSubmenu("Move to section");
    const building = await screen.findByRole("menuitem", { name: "Building" });
    expect(screen.getByRole("menuitem", { name: "Planning" })).not.toBeNull();
    fireEvent.click(building);

    expect(moveThreadToSection).toHaveBeenCalledWith({
      thread: expect.objectContaining({ id: thread.id, sectionId: null, pinnedAt: null }),
      sectionId: "sec_building",
    });
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(hidden);
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual(order);
  });

  it("moves from the overflow menu and indicates the current section", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    openWide();
    await openSubmenu("Move to section");
    const building = await screen.findByRole("menuitem", { name: "Building" });
    const current = screen.getByRole("menuitem", { name: "Planning" });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(building);
    expect(moveThreadToSection).toHaveBeenCalledWith({
      thread: expect.objectContaining({ id: thread.id, sectionId: "sec_planning" }),
      sectionId: "sec_building",
    });
  });

  it("does not add section controls outside Manual organization", () => {
    renderWide(<ThreadActionsMenu thread={thread} />, false);
    openWide();
    expect(
      screen.queryByRole("menuitem", { name: "Move to section" }),
    ).toBeNull();
  });

  it("does not offer section moves for nested child threads", () => {
    const childThread = makeThreadListEntry({
      ...thread,
      id: "thread-child",
      parentThreadId: thread.id,
    });
    renderWide(<ThreadActionsMenu thread={childThread} />);
    openWide();
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
