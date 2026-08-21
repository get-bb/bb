// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(cleanup);

describe("SubagentsChip child list", () => {
  it("caps a long menu and makes the child list scrollable", () => {
    renderSlot(
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
            thread({ id: "parent", title: "Parent" }),
            ...Array.from({ length: 26 }, (_, index) =>
              thread({
                id: `child_${index}`,
                title: `Child ${index + 1}`,
                parentThreadId: "parent",
                createdAt: index,
              }),
            ),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "26 child threads" }));

    const menu = screen.getByRole("menu", { name: "Child threads" });
    const list = menu.querySelector("ul");
    expect(menu.classList.contains("flex")).toBe(true);
    expect(
      menu.classList.contains("max-h-[min(32rem,calc(100dvh-6rem))]"),
    ).toBe(true);
    expect(list?.classList.contains("min-h-0")).toBe(true);
    expect(list?.classList.contains("overflow-y-auto")).toBe(true);
    expect(list?.classList.contains("overscroll-contain")).toBe(true);
    expect(list?.classList.contains("touch-pan-y")).toBe(true);
    expect(list?.classList.contains("[-webkit-overflow-scrolling:touch]")).toBe(
      true,
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(26);
  });
});
