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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";
import { ThreadSectionMoveProvider } from "./ThreadSectionMoveProvider";

const moveThreadToSection = vi.hoisted(() => vi.fn());
const copyToClipboardWithToast = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const defaultExecutionOptions = vi.hoisted(() => vi.fn());
const spawn = vi.hoisted(() => vi.fn());
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

vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => navigate,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  findCachedProviderInfo: () => ({
    capabilities: { supportsServiceTier: true },
  }),
}));

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      ...actual.sdk,
      threads: {
        ...actual.sdk.threads,
        defaultExecutionOptions,
        spawn,
      },
    },
  };
});

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
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const content = withMoveProvider ? (
    <ThreadSectionMoveProvider destinations={destinations}>
      {children}
    </ThreadSectionMoveProvider>
  ) : (
    children
  );
  return render(
    <Wrapper>
      <CompactViewportOverrideProvider isCompactViewport={false}>
        {content}
      </CompactViewportOverrideProvider>
    </Wrapper>,
  );
}

function renderCompact(children: ReactNode) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <CompactViewportOverrideProvider isCompactViewport>
        <ThreadSectionMoveProvider destinations={destinations}>
          {children}
        </ThreadSectionMoveProvider>
      </CompactViewportOverrideProvider>
    </Wrapper>,
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
  navigate.mockReset();
  defaultExecutionOptions.mockReset();
  spawn.mockReset();
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

const resolvedChildDefaults = {
  model: "gpt-5",
  serviceTier: "default" as const,
  reasoningLevel: "medium" as const,
  permissionMode: "auto" as const,
  source: "client/turn/requested" as const,
};

function makeChildCapableThread() {
  return makeThreadListEntry({
    id: "thread-parent",
    projectId: "proj_child",
    providerId: "codex",
    environmentId: "env_parent",
    pinnedAt: null,
    sectionId: null,
    title: "Parent",
  });
}

async function openThreadActionsMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Thread actions" }),
    { button: 0 },
  );
  return screen.findByRole("menuitem", { name: "New child thread" });
}

describe("ThreadActionsMenu new child thread", () => {
  it("creates a child thread with the parent defaults and opens it", async () => {
    const parent = makeChildCapableThread();
    defaultExecutionOptions.mockResolvedValue(resolvedChildDefaults);
    spawn.mockResolvedValue(
      makeThreadResponse({
        id: "thread-child",
        projectId: parent.projectId,
        environmentId: parent.environmentId,
        parentThreadId: parent.id,
      }),
    );
    renderWide(<ThreadActionsMenu thread={parent} />);

    fireEvent.click(await openThreadActionsMenu());

    await waitFor(() =>
      expect(spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: { type: "reuse", environmentId: "env_parent" },
          input: [],
          originKind: null,
          parentThreadId: "thread-parent",
          permissionMode: "auto",
          reasoningLevel: "medium",
          serviceTier: "default",
          startedOnBehalfOf: null,
        }),
      ),
    );
    expect(defaultExecutionOptions).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      threadId: "thread-parent",
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/projects/proj_child/threads/thread-child",
      ),
    );
  });

  it("hides the item for archived and deleted threads", async () => {
    const parent = makeChildCapableThread();
    const archived = makeThreadListEntry({ ...parent, archivedAt: 1 });
    const deleted = makeThreadListEntry({ ...parent, deletedAt: 1 });

    const archivedView = renderWide(<ThreadActionsMenu thread={archived} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "New child thread" }),
    ).toBeNull();
    archivedView.unmount();

    renderWide(<ThreadActionsMenu thread={deleted} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "New child thread" }),
    ).toBeNull();
  });

  it("hides the item when the thread cannot spawn a child", async () => {
    renderWide(
      <ThreadActionsMenu thread={makeChildCapableThread()} canSpawnChild={false} />,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "New child thread" }),
    ).toBeNull();
  });

  it("hides the item for hidden threads", async () => {
    const hidden = makeThreadListEntry({
      ...makeChildCapableThread(),
      visibility: "hidden",
    });
    renderWide(<ThreadActionsMenu thread={hidden} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    expect(
      screen.queryByRole("menuitem", { name: "New child thread" }),
    ).toBeNull();
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

  it("supports Back and resets the compact overflow menu after a move", async () => {
    renderCompact(<ThreadActionsMenu thread={thread} />);

    const trigger = screen.getByRole("button", { name: "Thread actions" });
    fireEvent.click(trigger);
    const moveToSection = await screen.findByRole("menuitem", {
      name: "Move to section",
    });
    expect(moveToSection.querySelector('[data-icon="MoveTo"]')).not.toBeNull();
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
