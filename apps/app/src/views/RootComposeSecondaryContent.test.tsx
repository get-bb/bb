// @vitest-environment jsdom

import {
  createElement,
  forwardRef,
  useImperativeHandle,
  type ComponentProps,
  type ReactNode,
} from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createPortal } from "react-dom";
import { Panel, type ImperativePanelHandle } from "react-resizable-panels";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import {
  PaneContext,
  type PaneContextValue,
} from "./thread-detail/PaneContext";
import {
  ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS,
  RootComposeSecondaryContent as RootComposeSecondaryContentSurface,
} from "./RootComposeSecondaryContent";
import type { SecondaryPanelLayoutDependencies } from "@/components/secondary-panel/SecondaryPanelLayout";
import {
  getBbDesktopInfo,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";

type RootComposeSecondaryContentProps = ComponentProps<
  typeof RootComposeSecondaryContentSurface
>;

interface PanelGroupHandle {
  getId: () => string;
  getLayout: () => number[];
  setLayout: (layout: number[]) => void;
}

interface PanelGroupProps {
  children?: ReactNode;
}

interface RenderRootComposeArgs {
  isCompactViewport: boolean;
  isSecondaryPanelOpen: boolean;
  isTopRow?: boolean;
}

type TestDesktopWindow = {
  bbDesktop?: { platform: "macos" };
};

const panelGroupState = vi.hoisted(() => ({
  getLayout: vi.fn(() => [60, 40]),
  setLayout: vi.fn(),
}));

const noop = () => {};

function setMacosDesktopChrome(): void {
  /* SAFETY: The test controls this fixture and verifies its behavior. */ (
    window as TestDesktopWindow
  ).bbDesktop = { platform: "macos" };
}

function clearDesktopChrome(): void {
  delete (
    /* SAFETY: The test controls this fixture and verifies its behavior. */ (
      window as TestDesktopWindow
    ).bbDesktop
  );
}

const TestPanelGroup = forwardRef<PanelGroupHandle, PanelGroupProps>(
  ({ children }, ref) => {
    useImperativeHandle(
      ref,
      () => ({
        getId: () => "test-panel-group",
        getLayout: panelGroupState.getLayout,
        setLayout: panelGroupState.setLayout,
      }),
      [],
    );
    return createElement("div", { "data-testid": "panel-group" }, children);
  },
);
const TestPanel = forwardRef<
  ImperativePanelHandle,
  ComponentProps<typeof Panel>
>(({ children }, _ref) =>
  createElement("div", { "data-testid": "panel" }, children),
);
const TestDrawer = ({
  children,
  open,
}: Parameters<SecondaryPanelLayoutDependencies["ResponsiveDrawerShell"]>[0]) =>
  createPortal(
    createElement(
      "div",
      {
        "data-open": String(open),
        "data-testid": "responsive-drawer-shell",
      },
      children,
    ),
    document.body,
  );
const TestSecondaryPanel = ({
  browserDeck,
  inlinePanelToggle,
  isOpen,
  renderAsDrawer,
  showNewTabButton,
}: {
  browserDeck?: ReactNode;
  inlinePanelToggle?: "button" | "reserved" | "hidden";
  isOpen: boolean;
  renderAsDrawer: boolean;
  showNewTabButton?: boolean;
}) =>
  createElement(
    "section",
    {
      "data-open": String(isOpen),
      "data-inline-panel-toggle": inlinePanelToggle,
      "data-show-new-tab-button": String(showNewTabButton),
      "data-testid": renderAsDrawer
        ? "drawer-secondary-panel"
        : "inline-secondary-panel",
    },
    browserDeck,
  );
const TestHomepageSections = () =>
  createElement("div", { "data-testid": "plugin-homepage-sections" });

const testLayoutDependencies: SecondaryPanelLayoutDependencies = {
  Panel: TestPanel,
  PanelGroup: TestPanelGroup,
  ResponsiveDrawerShell: TestDrawer,
  dispatchBrowserViewBoundsSync: vi.fn(),
};

function TestRootComposeSecondaryContent(
  props: RootComposeSecondaryContentProps,
) {
  return (
    <RootComposeSecondaryContentSurface
      {...props}
      dependencies={{
        LazyThreadSecondaryPanel: TestSecondaryPanel,
        PluginHomepageSections: TestHomepageSections,
        secondaryPanelLayout: SecondaryPanelLayout,
        secondaryPanelLayoutDependencies: testLayoutDependencies,
        getBbDesktopInfo,
        shouldUseMacosDesktopChrome,
      }}
    />
  );
}

const RootComposeSecondaryContent = TestRootComposeSecondaryContent;

function createSecondaryPanel(
  isOpen: boolean,
): RootComposeSecondaryContentProps["secondaryPanel"] {
  return {
    activeTab: null,
    canUseGitUi: false,
    tabs: [],
    fixedTabs: [],
    isOpen,
    metadataContent: null,
    onCollapse: noop,
    onClose: noop,
    onTabReorder: noop,
    onOpenNewTab: noop,
    onPanelFocus: noop,
  };
}

function withPaneContext(
  children: ReactNode,
  isTopRow: boolean | undefined,
): ReactNode {
  if (isTopRow === undefined) return children;
  const value: PaneContextValue = {
    paneId: "pane-test",
    isFocused: true,
    isSplitPane: true,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: noop,
    isMaximized: false,
    onToggleMaximize: noop,
    isBoundedPane: true,
    isTopRow,
    ownsWindowTopLeft: isTopRow,
    navigateInPane: noop,
  };
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

function renderRootCompose(args: RenderRootComposeArgs) {
  let renderArgs = args;
  const store = createStore();
  store.set(secondaryPanelWidthPercentAtom, 40);
  const content = (
    <Provider store={store}>
      <CompactViewportOverrideProvider
        isCompactViewport={renderArgs.isCompactViewport}
      >
        <RootComposeSecondaryContent
          isSecondaryPanelOpen={renderArgs.isSecondaryPanelOpen}
          onToggleSecondaryPanel={() => undefined}
          secondaryPanel={createSecondaryPanel(renderArgs.isSecondaryPanelOpen)}
        >
          <div data-testid="root-compose-content" />
        </RootComposeSecondaryContent>
      </CompactViewportOverrideProvider>
    </Provider>
  );
  const view = render(withPaneContext(content, renderArgs.isTopRow));

  return {
    ...view,
    rerenderWith(nextArgs: Partial<RenderRootComposeArgs>) {
      renderArgs = { ...renderArgs, ...nextArgs };
      const nextContent = (
        <Provider store={store}>
          <CompactViewportOverrideProvider
            isCompactViewport={renderArgs.isCompactViewport}
          >
            <RootComposeSecondaryContent
              isSecondaryPanelOpen={renderArgs.isSecondaryPanelOpen}
              onToggleSecondaryPanel={() => undefined}
              secondaryPanel={createSecondaryPanel(
                renderArgs.isSecondaryPanelOpen,
              )}
            >
              <div data-testid="root-compose-content" />
            </RootComposeSecondaryContent>
          </CompactViewportOverrideProvider>
        </Provider>
      );
      view.rerender(withPaneContext(nextContent, renderArgs.isTopRow));
    },
  };
}

afterEach(() => {
  cleanup();
  clearDesktopChrome();
  panelGroupState.setLayout.mockReset();
});

describe("RootComposeSecondaryContent desktop layout", () => {
  it("always offers a new tab from the new-thread right panel", async () => {
    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: true,
    });

    expect(
      (await screen.findByTestId("inline-secondary-panel")).getAttribute(
        "data-show-new-tab-button",
      ),
    ).toBe("true");
    expect(screen.getByTestId("root-compose-content")).not.toBeNull();
    expect(screen.getByTestId("plugin-homepage-sections")).not.toBeNull();
  });

  it("keeps the drag strip on a split pane that touches the window top edge", () => {
    setMacosDesktopChrome();

    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
      isTopRow: true,
    });

    expect(
      screen.getByTestId("root-compose-main-window-drag-strip"),
    ).toBeTruthy();
  });

  it("does not create a native pointer dead zone in a lower split pane", () => {
    setMacosDesktopChrome();

    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
      isTopRow: false,
    });

    expect(
      screen.queryByTestId("root-compose-main-window-drag-strip"),
    ).toBeNull();
  });

  it("carves the fixed toggle footprint out of the drag strip while the panel is closed", () => {
    setMacosDesktopChrome();

    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
    });

    const strip = screen.getByTestId("root-compose-main-window-drag-strip");
    const cutout = screen.getByTestId("root-compose-drag-strip-toggle-cutout");
    expect(cutout.parentElement).toBe(strip);
    expect(cutout.className).toContain("[app-region:no-drag]");
    expect(cutout.className).toContain("[-webkit-app-region:no-drag]");
    for (const positionClass of ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS.split(
      " ",
    )) {
      expect(cutout.className).toContain(positionClass);
    }
  });

  it("keeps the drag strip whole while the panel is open", () => {
    setMacosDesktopChrome();

    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: true,
    });

    expect(
      screen.getByTestId("root-compose-main-window-drag-strip"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("root-compose-drag-strip-toggle-cutout"),
    ).toBeNull();
  });

  it("reserves the inline toolbar for the fixed toggle", () => {
    renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: true,
    });

    expect(
      screen
        .getByTestId("inline-secondary-panel")
        .getAttribute("data-inline-panel-toggle"),
    ).toBe("reserved");
  });

  it("animates root panel open and close state through the shared desktop layout", () => {
    const view = renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
    });

    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([100, 0]);
    panelGroupState.setLayout.mockClear();

    view.rerenderWith({ isSecondaryPanelOpen: true });
    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);

    panelGroupState.setLayout.mockClear();
    view.rerenderWith({ isSecondaryPanelOpen: false });
    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([100, 0]);
  });

  it("shows the root fallback before realizing compact drawer content", () => {
    vi.useFakeTimers();
    try {
      renderRootCompose({
        isCompactViewport: true,
        isSecondaryPanelOpen: true,
      });

      expect(panelGroupState.setLayout).not.toHaveBeenCalled();
      expect(screen.queryByTestId("drawer-secondary-panel")).toBeNull();
      expect(
        screen.getByTestId("drawer-panel-loading-skeleton"),
      ).not.toBeNull();

      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(screen.getByTestId("drawer-secondary-panel")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
