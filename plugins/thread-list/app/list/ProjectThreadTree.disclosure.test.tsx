// @vitest-environment jsdom

import { ThreadRowNavigationProvider } from "../rows/threadRowNavigation.js";
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import { SidebarRenameProvider } from "../rows/SidebarInlineRename.js";

installTestPluginRuntime();
const { ProjectThreadTree } = await import("./ProjectRow.js");

function Slot({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ThreadRowNavigationProvider>
        <SidebarRenameProvider>{children}</SidebarRenameProvider>
      </ThreadRowNavigationProvider>
    </TooltipProvider>
  );
}

describe("ProjectThreadTree", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={vi.fn()}
          />
        ),
      },
    );

    expect(screen.getByText("Threads unavailable")).not.toBeNull();
  });
});
