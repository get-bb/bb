// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  PaneContext,
  type PaneContextValue,
} from "./thread-detail/PaneContext";
import {
  RootComposeSecondaryContent,
  useRootComposePinnedPanelToggleBoxClassName,
} from "./RootComposeSecondaryContent";
import { panelGroupState } from "@/test/react-resizable-panels-stub";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";

type RootComposeSecondaryContentProps = ComponentProps<
  typeof RootComposeSecondaryContent
>;

interface RenderRootComposeArgs {
  isCompactViewport: boolean;
  isSecondaryPanelOpen: boolean;
  isTopRow?: boolean;
}

type TestDesktopWindow = {
  bbDesktop?: { platform: "macos" };
};

const noop = () => {};

function setMacosDesktopChrome(): void {
  (window as unknown as TestDesktopWindow).bbDesktop = { platform: "macos" };
}

function clearDesktopChrome(): void {
  delete (window as unknown as TestDesktopWindow).bbDesktop;
}

vi.mock(
  "react-resizable-panels",
  () => import("@/test/react-resizable-panels-stub"),
);

vi.mock("@bb/shared-ui/responsive-overlay", async (importOriginal) => {
  const React = await import("react");
  const actual =
    await importOriginal<typeof import("@bb/shared-ui/responsive-overlay")>();

  const PersistentResponsiveDrawerShell = ({
    children,
    open,
  }: {
    children?: ReactNode;
    open: boolean;
  }) =>
    React.createElement(
      "div",
      {
        "data-open": String(open),
        "data-testid": "responsive-drawer-shell",
      },
      children,
    );

  return { ...actual, PersistentResponsiveDrawerShell };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async () => {
  const React = await import("react");

  const ThreadSecondaryPanel = ({
    browserDeck,
    isOpen,
    renderAsDrawer,
    showNewTabButton,
  }: {
    browserDeck?: ReactNode;
    isOpen: boolean;
    renderAsDrawer: boolean;
    showNewTabButton?: boolean;
  }) =>
    React.createElement(
      "section",
      {
        "data-open": String(isOpen),
        "data-show-new-tab-button": String(showNewTabButton),
        "data-testid": renderAsDrawer
          ? "drawer-secondary-panel"
          : "inline-secondary-panel",
      },
      browserDeck,
    );

  return { ThreadSecondaryPanel };
});

vi.mock("@/components/plugin/PluginHomepageSections", async () => {
  const React = await import("react");
  return {
    PluginHomepageSections: () =>
      React.createElement("div", { "data-testid": "plugin-homepage-sections" }),
  };
});

function createSecondaryPanel(
  isOpen: boolean,
): RootComposeSecondaryContentProps["secondaryPanel"] {
  return {
    activeTab: null,
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
  const renderContent = () =>
    withPaneContext(
      <Provider store={store}>
        <CompactViewportOverrideProvider
          isCompactViewport={renderArgs.isCompactViewport}
        >
          <RootComposeSecondaryContent
            compactScrollContent={null}
            isCompactHomeLayout={false}
            isSecondaryPanelOpen={renderArgs.isSecondaryPanelOpen}
            onToggleSecondaryPanel={() => undefined}
            secondaryPanel={createSecondaryPanel(
              renderArgs.isSecondaryPanelOpen,
            )}
          >
            <div data-testid="root-compose-content" />
          </RootComposeSecondaryContent>
        </CompactViewportOverrideProvider>
      </Provider>,
      renderArgs.isTopRow,
    );
  const view = render(renderContent());

  return {
    ...view,
    rerenderWith(nextArgs: Partial<RenderRootComposeArgs>) {
      renderArgs = { ...renderArgs, ...nextArgs };
      view.rerender(renderContent());
    },
  };
}

afterEach(() => {
  cleanup();
  clearDesktopChrome();
  panelGroupState.setLayout.mockReset();
});

describe("RootComposeSecondaryContent desktop layout", () => {
  it("mounts compact scroll content only while the compact home layout is active and keeps the composer mounted", () => {
    const compactContent = (
      <ul data-testid="compact-recents">
        {Array.from({ length: 1000 }, (_, index) => (
          <li key={index}>Thread {index}</li>
        ))}
      </ul>
    );
    const content = (isCompactViewport: boolean) => (
      <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
        <RootComposeSecondaryContent
          compactScrollContent={compactContent}
          isCompactHomeLayout={isCompactViewport}
          isSecondaryPanelOpen={false}
          onToggleSecondaryPanel={noop}
          secondaryPanel={createSecondaryPanel(false)}
        >
          <div data-testid="root-compose-content" />
        </RootComposeSecondaryContent>
      </CompactViewportOverrideProvider>
    );
    const view = render(content(false));
    const composer = screen.getByTestId("root-compose-content");

    expect(screen.queryByTestId("compact-recents")).toBeNull();
    expect(screen.getByTestId("plugin-homepage-sections")).not.toBeNull();

    view.rerender(content(true));

    expect(screen.getByTestId("compact-recents").children).toHaveLength(1000);
    expect(screen.getByTestId("root-compose-content")).toBe(composer);
    expect(screen.getByTestId("plugin-homepage-sections")).not.toBeNull();

    view.rerender(content(false));

    expect(screen.queryByTestId("compact-recents")).toBeNull();
    expect(screen.getByTestId("root-compose-content")).toBe(composer);
    expect(screen.getByTestId("plugin-homepage-sections")).not.toBeNull();
  });

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

  it("carves the pinned toggle footprint out of the drag strip while the panel is closed", () => {
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
    const toggleBoxClassName = renderHook(() =>
      useRootComposePinnedPanelToggleBoxClassName(),
    ).result.current;
    for (const boxClass of toggleBoxClassName.split(" ")) {
      expect(cutout.className).toContain(boxClass);
    }
  });

  it("keeps the drag strip whole while the panel is open (the panel chrome carves instead)", () => {
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

  it("forwards root panel open and close state to the shared desktop layout", () => {
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

  it("shows the root fallback before realizing compact drawer content", async () => {
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      vi.useRealTimers();

      expect(
        await screen.findByTestId("drawer-secondary-panel"),
      ).not.toBeNull();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
});
