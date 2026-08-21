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

function mockCompactGeometry({
  triggerRight,
  triggerBottom = 48,
  menuWidth,
}: {
  triggerRight: number;
  triggerBottom?: number;
  menuWidth: number;
}) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (
        this instanceof HTMLButtonElement &&
        this.getAttribute("aria-label")?.endsWith("child threads")
      ) {
        return { right: triggerRight, bottom: triggerBottom } as DOMRect;
      }
      if (this.getAttribute("role") === "menu") {
        return { width: menuWidth } as DOMRect;
      }
      return { width: 0 } as DOMRect;
    },
  );
}

function stubVisualViewport({
  left = 0,
  top = 0,
  width,
  height = 844,
}: {
  left?: number;
  top?: number;
  width: number;
  height?: number;
}) {
  vi.stubGlobal("visualViewport", {
    offsetLeft: left,
    offsetTop: top,
    width,
    height,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
}

function setSafeArea({
  left = 0,
  top = 0,
  right = 0,
  bottom = 0,
}: {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}) {
  const probe = document.querySelector<HTMLElement>(
    "[data-child-menu-safe-area-probe]",
  );
  if (!probe) throw new Error("Missing safe-area probe");
  probe.style.paddingLeft = `${left}px`;
  probe.style.paddingTop = `${top}px`;
  probe.style.paddingRight = `${right}px`;
  probe.style.paddingBottom = `${bottom}px`;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SubagentsChip menu position", () => {
  it("measures the rendered rem-sized menu before clamping", () => {
    renderCompact();
    stubVisualViewport({ width: 390 });
    mockCompactGeometry({ triggerRight: 380, menuWidth: 374 });

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));

    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.style.maxWidth).toBe("374px");
    expect(menu.style.left).toBe("8px");
  });

  it("stays right-aligned to the chip while the menu fits on screen", () => {
    renderCompact();
    stubVisualViewport({ width: 390 });
    mockCompactGeometry({ triggerRight: 380, menuWidth: 320 });

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));

    expect(screen.getByRole("menu", { name: "Child threads" }).style.left).toBe(
      "60px",
    );
  });

  it("uses the visual viewport offset and width", () => {
    renderCompact();
    stubVisualViewport({ left: 100, width: 300 });
    mockCompactGeometry({ triggerRight: 380, menuWidth: 284 });

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));

    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.style.maxWidth).toBe("284px");
    expect(menu.style.left).toBe("108px");
  });

  it("keeps the menu inside horizontal safe-area insets", () => {
    renderCompact();
    stubVisualViewport({ width: 390 });
    setSafeArea({ left: 44, right: 20 });
    mockCompactGeometry({ triggerRight: 380, menuWidth: 310 });

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));

    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.style.maxWidth).toBe("310px");
    expect(menu.style.left).toBe("52px");
  });

  it("keeps the menu inside the visual viewport height", () => {
    renderCompact();
    stubVisualViewport({ top: 200, width: 390, height: 300 });
    setSafeArea({ top: 10, bottom: 20 });
    mockCompactGeometry({
      triggerRight: 380,
      triggerBottom: 260,
      menuWidth: 320,
    });

    fireEvent.click(screen.getByRole("button", { name: "1 child threads" }));

    const menu = screen.getByRole("menu", { name: "Child threads" });
    expect(menu.style.top).toBe("268px");
    expect(menu.style.maxHeight).toBe("min(32rem, 204px)");
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
