// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { sidebarShowThreadNumbersAtom } from "./sidebarCollapsedAtoms";

const { appCommandShortcuts } = vi.hoisted(() => ({
  appCommandShortcuts: new Map(),
}));

vi.mock("./ProjectList", () => ({
  ProjectList: () => (
    <a
      href="/projects/project-1/threads/thread-1"
      data-sidebar-thread-shortcut-target
      data-sidebar-thread-id="thread-1"
    >
      Thread one
    </a>
  ),
  ProjectListActionButtons: () => null,
}));

vi.mock("./PluginThreadList", () => ({
  PluginThreadList: () => null,
}));

vi.mock("./threadListProvider", () => ({
  useThreadListReplacement: () => null,
}));

vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  PluginNavSidebarItems: () => null,
}));

vi.mock("@/components/plugin/PluginSidebarFooterActions", () => ({
  PluginSidebarFooterActions: () => null,
}));

vi.mock("./SidebarUpdatesBadge", () => ({
  SidebarUpdatesBadge: () => null,
}));

vi.mock("./SidebarHistoryNavigationControls", () => ({
  SidebarHistoryNavigationControls: () => null,
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: false,
    isCreating: false,
    openCreateDialog: vi.fn(),
  }),
}));

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));

vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => undefined,
}));

vi.mock("./useSidebarThreadSearch", () => ({
  useSidebarThreadSearch: () => ({
    activeDescendantId: undefined,
    activeIndex: -1,
    inputRef: { current: null },
    isActive: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onExternalThreadOpen: vi.fn(),
    onKeyDown: vi.fn(),
    onNavigationItemsChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelectItem: vi.fn(),
    query: "",
  }),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: vi.fn(),
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => appCommandShortcuts,
  useIndexedAppCommandHandlers: vi.fn(),
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: null }),
}));

vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => false,
}));

class RecordingMutationObserver implements MutationObserver {
  static instances: RecordingMutationObserver[] = [];

  readonly disconnect = vi.fn();
  observedRoot: Node | null = null;

  constructor(readonly callback: MutationCallback) {
    RecordingMutationObserver.instances.push(this);
  }

  observe(target: Node): void {
    this.observedRoot = target;
  }

  takeRecords(): MutationRecord[] {
    return [];
  }
}

afterEach(() => {
  cleanup();
  RecordingMutationObserver.instances = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderAppSidebar(
  isCompactViewport: boolean,
  store: ReturnType<typeof createStore>,
) {
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <Provider store={store}>
        <MemoryRouter>
          <SidebarProvider>
            <AppSidebar
              onResizeMouseDown={vi.fn()}
              isResizing={false}
              showTopReserve={false}
              settingsRoutePath="/settings"
            />
          </SidebarProvider>
        </MemoryRouter>
      </Provider>
    </CompactViewportOverrideProvider>
  );
}

describe("AppSidebar", () => {
  it("observes sidebar rows only while thread numbers are visible", () => {
    vi.stubGlobal("MutationObserver", RecordingMutationObserver);
    const store = createStore();

    render(renderAppSidebar(false, store));

    expect(RecordingMutationObserver.instances).toHaveLength(0);

    act(() => store.set(sidebarShowThreadNumbersAtom, true));

    expect(RecordingMutationObserver.instances).toHaveLength(1);
    const observer = RecordingMutationObserver.instances[0];
    expect(observer?.observedRoot?.isConnected).toBe(true);

    act(() => store.set(sidebarShowThreadNumbersAtom, false));

    expect(observer?.disconnect).toHaveBeenCalledOnce();
    expect(RecordingMutationObserver.instances).toHaveLength(1);
  });

  it("rebinds thread shortcut observation to the compact sidebar root", () => {
    vi.stubGlobal("MutationObserver", RecordingMutationObserver);
    const store = createStore();
    store.set(sidebarShowThreadNumbersAtom, true);

    const view = render(renderAppSidebar(false, store));

    expect(RecordingMutationObserver.instances).toHaveLength(1);
    const desktopObserver = RecordingMutationObserver.instances[0];
    const desktopRoot = desktopObserver?.observedRoot;
    expect(desktopRoot?.isConnected).toBe(true);

    view.rerender(renderAppSidebar(true, store));

    expect(desktopObserver?.disconnect).toHaveBeenCalledOnce();
    expect(desktopRoot?.isConnected).toBe(false);
    expect(RecordingMutationObserver.instances).toHaveLength(2);
    const compactRoot = RecordingMutationObserver.instances[1]?.observedRoot;
    expect(compactRoot).not.toBe(desktopRoot);
    expect(compactRoot?.isConnected).toBe(true);
  });
});
