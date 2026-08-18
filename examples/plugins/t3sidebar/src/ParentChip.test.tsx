// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

// Load through the harness so the plugin's `@get-bb/plugin-sdk/app` import binds
// to the test runtime.
const app = await loadPluginApp(() => import("../app"));
const parentChip = app.threadHeaderActions.find(
  (slot) => slot.id === "parent",
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

function render(
  threads: PluginSidebarThread[],
  threadId: string,
  isCompactViewport = false,
) {
  return renderSlot(
    parentChip,
    { threadId, projectId: "proj_1", isCompactViewport },
    {
      sidebarThreads: {
        status: "ready",
        threads,
        projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
      },
    },
  );
}

afterEach(cleanup);

describe("ParentChip", () => {
  // The whole reason the chip exists: the list hides the child, so this is its
  // only route back.
  it("opens the parent on click", () => {
    const rendered = render(
      [
        thread({ id: "parent", title: "Parent thread" }),
        thread({ id: "child", parentThreadId: "parent" }),
      ],
      "child",
    );
    fireEvent.click(screen.getByRole("button"));
    expect(rendered.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "parent",
      options: undefined,
    });
  });

  it("renders nothing on a root thread", () => {
    render([thread({ id: "root" })], "root");
    expect(screen.queryByRole("button")).toBeNull();
  });

  // An archived parent is out of the list but still the way back.
  it("names an archived parent", () => {
    render(
      [
        thread({ id: "parent", title: "Archived parent", isArchived: true }),
        thread({ id: "child", parentThreadId: "parent" }),
      ],
      "child",
    );
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "Back to parent: Archived parent",
    );
  });

  // The header row is short: a phone shows the chevron and the disc only, but
  // the control keeps its name.
  it("drops the title on a compact viewport", () => {
    render(
      [
        thread({ id: "parent", title: "Parent thread" }),
        thread({ id: "child", parentThreadId: "parent" }),
      ],
      "child",
      true,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("");
    expect(button.getAttribute("aria-label")).toBe(
      "Back to parent: Parent thread",
    );
  });
});
