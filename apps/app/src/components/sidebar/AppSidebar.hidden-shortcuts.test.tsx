// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, () => boolean>(),
  openSearch: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: (id: string, handler: () => boolean) =>
    mocks.handlers.set(id, handler),
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => new Map(),
  useIndexedAppCommandHandlers: () => {},
  useIsAppCommandModifierHeld: () => false,
}));
vi.mock("./useSidebarThreadSearch", () => ({
  useSidebarThreadSearch: () => ({
    activeDescendantId: undefined,
    activeIndex: 0,
    inputRef: { current: null },
    isActive: false,
    onActivate: mocks.openSearch,
    onActiveIndexChange: vi.fn(),
    onClose: vi.fn(),
    onExternalThreadOpen: vi.fn(),
    onKeyDown: vi.fn(),
    onNavigationItemsChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelectItem: vi.fn(),
    query: "",
  }),
}));
vi.mock("./SidebarNavigationRegion", () => ({
  SidebarNavigationRegion: () => <div>Navigation</div>,
}));
vi.mock("./PluginThreadList", () => ({
  PluginThreadList: () => <div>Threads</div>,
}));
vi.mock("./threadListProvider", () => ({
  useThreadListReplacement: () => ({ kind: "owner" }),
}));
vi.mock("@/components/plugin/PluginSidebarFooterActions", () => ({
  PluginSidebarFooterActions: () => null,
}));
vi.mock("./SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));
vi.mock("./SidebarUpdatesBadge", () => ({ SidebarUpdatesBadge: () => null }));
vi.mock("./SidebarHistoryNavigationControls", () => ({
  SidebarHistoryNavigationControls: () => null,
}));
vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: false,
    isCreating: false,
  }),
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => ({ openInSplit: vi.fn() }),
}));
vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => false,
}));
vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ projectId: null, threadId: null }),
}));

afterEach(() => {
  cleanup();
  mocks.handlers.clear();
  mocks.openSearch.mockReset();
});

describe("AppSidebar hidden hosted body shortcuts", () => {
  it("does not let a retained hidden app body claim Search", () => {
    const view = render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar
            isResizing={false}
            mobileHosted={{ hidden: true }}
            onResizeMouseDown={vi.fn()}
            settingsRoutePath="/settings"
            showTopReserve
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    expect(mocks.handlers.get("thread.search")?.()).toBe(false);
    expect(mocks.openSearch).not.toHaveBeenCalled();

    view.rerender(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar
            isResizing={false}
            mobileHosted={{ hidden: false }}
            onResizeMouseDown={vi.fn()}
            settingsRoutePath="/settings"
            showTopReserve
          />
        </SidebarProvider>
      </MemoryRouter>,
    );
    expect(mocks.handlers.get("thread.search")?.()).toBe(true);
    expect(mocks.openSearch).toHaveBeenCalledOnce();
  });
});
