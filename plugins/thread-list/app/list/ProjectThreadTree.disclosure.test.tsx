// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { makeSidebarThread } from "../model/fixtures.js";

installTestPluginRuntime();
const { ProjectThreadTree } = await import("./ProjectRow.js");

function Slot({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>;
}

function makePlainThreads(count: number): SidebarThread[] {
  return Array.from({ length: count }, (_, index) =>
    makeSidebarThread({
      lastReadAt: 100,
      latestAttentionAt: 100,
      id: `thr_item_${index}`,
      title: `Thread ${index}`,
      titleFallback: `Thread ${index}`,
      createdAt: index,
      updatedAt: index,
    }),
  );
}

function renderThreadTree(
  threads: SidebarThread[],
  { selectedThreadId }: { selectedThreadId?: string } = {},
) {
  return renderSlot(
    { component: Slot },
    {
      children: (
        <ProjectThreadTree
          threadListState={{ status: "ready", threads }}
          compareThreads={() => 0}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={new Set()}
          collapsedEnvironmentIds={new Set()}
          variant="section"
          onToggleThreadCollapsed={vi.fn()}
          onToggleEnvironmentCollapsed={vi.fn()}
        />
      ),
    },
    { sidebarThreads: { threads } },
  );
}

describe("ProjectThreadTree without progressive disclosure", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the full list without a Show more control", () => {
    renderThreadTree(makePlainThreads(17));

    expect(screen.getByText("Thread 0")).not.toBeNull();
    expect(screen.getByText("Thread 5")).not.toBeNull();
    expect(screen.getByText("Thread 16")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("renders nested threads under their parent", () => {
    const threads = makePlainThreads(8);
    threads[7] = {
      ...threads[7],
      parentThreadId: threads[6].id,
      hasPendingInteraction: true,
    };
    renderThreadTree(threads);

    expect(screen.getByText("Thread 6")).not.toBeNull();
    expect(screen.getByText("Thread 7")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Collapse Thread 6 threads" }),
    ).not.toBeNull();
  });

  it("shows the unavailable state instead of rows when threads cannot load", () => {
    renderSlot(
      { component: Slot },
      {
        children: (
          <ProjectThreadTree
            threadListState={{ status: "unavailable" }}
            compareThreads={() => 0}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            variant="section"
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={vi.fn()}
          />
        ),
      },
    );

    expect(screen.getByText("Threads unavailable")).not.toBeNull();
  });
});
