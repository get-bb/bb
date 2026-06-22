// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport.js";
import { RootComposeSecondaryContent } from "./RootComposeSecondaryContent";

type RootComposeSecondaryContentProps = ComponentProps<
  typeof RootComposeSecondaryContent
>;

interface PanelGroupHandle {
  setLayout: (layout: number[]) => void;
}

interface PanelGroupProps {
  children?: ReactNode;
}

interface PanelProps {
  children?: ReactNode;
}

interface RenderRootComposeArgs {
  isCompactViewport: boolean;
  isSecondaryPanelOpen: boolean;
}

const panelGroupState = vi.hoisted(() => ({
  setLayout: vi.fn(),
}));

const noop = () => {};

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => 40,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");

  const PanelGroup = React.forwardRef<PanelGroupHandle, PanelGroupProps>(
    ({ children }, ref) => {
      React.useImperativeHandle(
        ref,
        () => ({ setLayout: panelGroupState.setLayout }),
        [],
      );
      return React.createElement(
        "div",
        { "data-testid": "panel-group" },
        children,
      );
    },
  );
  PanelGroup.displayName = "MockPanelGroup";

  const Panel = ({ children }: PanelProps) =>
    React.createElement("div", { "data-testid": "panel" }, children);

  return { Panel, PanelGroup };
});

vi.mock("@/components/ui/responsive-overlay.js", async () => {
  const React = await import("react");

  const ResponsiveDrawerShell = ({
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

  return { ResponsiveDrawerShell };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async () => {
  const React = await import("react");

  const ThreadSecondaryPanel = ({
    browserDeck,
    isOpen,
    renderAsDrawer,
  }: {
    browserDeck?: ReactNode;
    isOpen: boolean;
    renderAsDrawer: boolean;
  }) =>
    React.createElement(
      "section",
      {
        "data-open": String(isOpen),
        "data-testid": renderAsDrawer
          ? "drawer-secondary-panel"
          : "inline-secondary-panel",
      },
      browserDeck,
    );

  return { ThreadSecondaryPanel };
});

function createSecondaryPanel(
  isOpen: boolean,
): RootComposeSecondaryContentProps["secondaryPanel"] {
  return {
    activeTab: null,
    canUseGitUi: false,
    fileTabs: [],
    isOpen,
    metadataContent: null,
    onCollapse: noop,
    onClose: noop,
    onFileTabReorder: noop,
    onOpenNewTab: noop,
    onPanelChange: noop,
    onPanelFocus: noop,
    showGitDiffTab: false,
    showInfoTab: false,
  };
}

function renderRootCompose(args: RenderRootComposeArgs) {
  let renderArgs = args;
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={renderArgs.isCompactViewport}
    >
      <RootComposeSecondaryContent
        isSecondaryPanelOpen={renderArgs.isSecondaryPanelOpen}
        secondaryPanel={createSecondaryPanel(renderArgs.isSecondaryPanelOpen)}
      >
        <div data-testid="root-compose-content" />
      </RootComposeSecondaryContent>
    </CompactViewportOverrideProvider>,
  );

  return {
    ...view,
    rerenderWith(nextArgs: Partial<RenderRootComposeArgs>) {
      renderArgs = { ...renderArgs, ...nextArgs };
      view.rerender(
        <CompactViewportOverrideProvider
          isCompactViewport={renderArgs.isCompactViewport}
        >
          <RootComposeSecondaryContent
            isSecondaryPanelOpen={renderArgs.isSecondaryPanelOpen}
            secondaryPanel={createSecondaryPanel(
              renderArgs.isSecondaryPanelOpen,
            )}
          >
            <div data-testid="root-compose-content" />
          </RootComposeSecondaryContent>
        </CompactViewportOverrideProvider>,
      );
    },
  };
}

afterEach(() => {
  cleanup();
  panelGroupState.setLayout.mockReset();
});

describe("RootComposeSecondaryContent desktop layout", () => {
  it("syncs the panel group when persisted open state arrives after mount", () => {
    const view = renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
    });

    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([100, 0]);
    panelGroupState.setLayout.mockClear();

    view.rerenderWith({ isSecondaryPanelOpen: true });

    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);
    expect(
      screen.getByTestId("inline-secondary-panel").getAttribute("data-open"),
    ).toBe("true");
  });

  it("syncs the panel group when the desktop root panel closes", () => {
    const view = renderRootCompose({
      isCompactViewport: false,
      isSecondaryPanelOpen: true,
    });

    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);
    panelGroupState.setLayout.mockClear();

    view.rerenderWith({ isSecondaryPanelOpen: false });

    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([100, 0]);
  });

  it("leaves the panel group alone while the root panel renders as a drawer", () => {
    const view = renderRootCompose({
      isCompactViewport: true,
      isSecondaryPanelOpen: false,
    });

    expect(panelGroupState.setLayout).not.toHaveBeenCalled();

    view.rerenderWith({ isSecondaryPanelOpen: true });

    expect(panelGroupState.setLayout).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("drawer-secondary-panel").getAttribute("data-open"),
    ).toBe("true");
  });
});
