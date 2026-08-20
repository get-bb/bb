// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

const app = await loadPluginApp(() => import("../app"));
const childrenChip = app.threadHeaderActions.find(
  (slot) => slot.id === "children",
)!;

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

function renderCompact() {
  return renderSlot(
    childrenChip,
    {
      threadId: "parent",
      projectId: "proj_1",
      isCompactViewport: true,
    },
    {
      sidebarThreads: {
        status: "ready",
        threads: [
          thread({ id: "parent" }),
          thread({ id: "child", parentThreadId: "parent" }),
        ],
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
    },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SubagentsChip menu position", () => {
  it("clamps only when right alignment would cross the viewport gutter", () => {
    renderCompact();
    vi.stubGlobal("innerWidth", 390);
    const trigger = screen.getByRole("button", { name: "1 child threads" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      right: 250,
    } as DOMRect);

    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.classList.contains("fixed")).toBe(true);
    expect(menu.classList.contains("w-80")).toBe(true);
    expect(menu.classList.contains("max-w-[calc(100vw-1rem)]")).toBe(true);
    expect(menu.style.left).toBe("8px");
  });

  it("stays right-aligned to the chip while the menu fits on screen", () => {
    renderCompact();
    vi.stubGlobal("innerWidth", 390);
    const trigger = screen.getByRole("button", { name: "1 child threads" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      right: 380,
    } as DOMRect);

    fireEvent.click(trigger);

    expect(
      screen.getByRole("menu", { name: "Child threads" }).style.left,
    ).toBe("60px");
  });

  it("keeps the desktop menu anchored to its header chip", () => {
    renderSlot(
      childrenChip,
      {
        threadId: "parent",
        projectId: "proj_1",
        isCompactViewport: false,
      },
      {
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({ id: "parent" }),
            thread({ id: "child", parentThreadId: "parent" }),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));
    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.classList.contains("absolute")).toBe(true);
    expect(menu.classList.contains("right-0")).toBe(true);
    expect(menu.classList.contains("w-80")).toBe(true);
  });
});
