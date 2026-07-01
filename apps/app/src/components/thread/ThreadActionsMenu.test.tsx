// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Thread } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { ThreadActionsMenu } from "./ThreadActionsMenu";

const mockActions = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  requestRename: vi.fn(),
  requestDelete: vi.fn(),
  sendToPopout: null as ((thread: Thread) => void) | null,
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => mockActions,
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    providerId: "codex",
    title: null,
    titleFallback: "Test thread",
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

async function renderOpenMenu(
  thread: Thread,
  { isCompactViewport = true }: { isCompactViewport?: boolean } = {},
) {
  const onOpenChange = vi.fn();
  render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <ThreadActionsMenu thread={thread} onOpenChange={onOpenChange} />
    </CompactViewportOverrideProvider>,
  );

  const trigger = screen.getByRole("button", { name: "Thread actions" });
  if (isCompactViewport) {
    fireEvent.click(trigger);
  } else {
    fireEvent.pointerDown(trigger, { button: 0 });
  }
  await screen.findByRole("menuitem", { name: /Mark / });
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  return onOpenChange;
}

function expectMenuItemIcon(label: string, iconName: string) {
  const menuItem = screen.getByRole("menuitem", { name: label });
  expect(menuItem.querySelector(`[data-icon="${iconName}"]`)).not.toBeNull();
}

function getMenuRoleSequence(): string[] {
  return Array.from(
    screen
      .getByRole("menu")
      .querySelectorAll('[role="menuitem"], [role="separator"]'),
  ).map((element) =>
    element.getAttribute("role") === "separator"
      ? "separator"
      : (element.textContent ?? "").trim(),
  );
}

describe("ThreadActionsMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockActions.sendToPopout = null;
  });

  it.each([
    {
      label: "Mark read",
      thread: makeThread(),
      action: mockActions.toggleRead,
    },
    {
      label: "Mark unread",
      thread: makeThread({ lastReadAt: 100, latestAttentionAt: 50 }),
      action: mockActions.toggleRead,
    },
    {
      label: "Pin",
      thread: makeThread(),
      action: mockActions.togglePin,
    },
    {
      label: "Unpin",
      thread: makeThread({ pinnedAt: 100 }),
      action: mockActions.togglePin,
    },
    {
      label: "Archive",
      thread: makeThread(),
      action: mockActions.archiveThreadAndChildren,
    },
    {
      label: "Unarchive",
      thread: makeThread({ archivedAt: 100 }),
      action: mockActions.unarchiveThread,
    },
  ])("closes after selecting $label", async ({ label, thread, action }) => {
    const onOpenChange = await renderOpenMenu(thread);

    fireEvent.click(screen.getByRole("menuitem", { name: label }));

    expect(action).toHaveBeenCalledWith(thread);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("renders icons for thread action menu items", async () => {
    await renderOpenMenu(makeThread());

    expectMenuItemIcon("Mark read", "MailOpen");
    expectMenuItemIcon("Pin", "Pin");
    expectMenuItemIcon("Rename", "Edit");
    expectMenuItemIcon("Archive", "Archive");
    expectMenuItemIcon("Delete", "Trash2");
  });

  it("omits dividers when rendering as a compact drawer", async () => {
    await renderOpenMenu(makeThread(), { isCompactViewport: true });

    expect(screen.queryAllByRole("separator")).toHaveLength(0);
  });

  it("renders one divider before lifecycle actions when the popout action is unavailable", async () => {
    await renderOpenMenu(makeThread(), { isCompactViewport: false });

    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(getMenuRoleSequence()).toEqual([
      "Mark read",
      "Pin",
      "Rename",
      "separator",
      "Archive",
      "Delete",
    ]);
  });

  it("renders both dividers when the popout action is available", async () => {
    mockActions.sendToPopout = vi.fn();

    await renderOpenMenu(makeThread(), { isCompactViewport: false });

    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });
});
