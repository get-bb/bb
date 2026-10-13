// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyThreadDetailView } from "./LazyThreadDetailView";
import { PaneContext, type PaneContextValue } from "./PaneContext";

vi.mock("./ThreadDetailView", () => new Promise(() => {}));

afterEach(cleanup);

function paneContext(isBoundedPane: boolean): PaneContextValue {
  return {
    paneId: "main",
    isFocused: true,
    isSplitPane: isBoundedPane,
    secondaryPanelHost: null,
    reservesWindowPanelToggle: false,
    onRequestClose: null,
    isMaximized: false,
    onToggleMaximize: null,
    isBoundedPane,
    isTopRow: true,
    ownsWindowTopLeft: true,
    navigateInPane: () => {},
  };
}

function renderLoadingPane(isBoundedPane: boolean) {
  render(
    <PaneContext.Provider value={paneContext(isBoundedPane)}>
      <LazyThreadDetailView
        surface="pane"
        projectId="proj_test"
        threadId="thr_test"
        timelineEnabled
      />
    </PaneContext.Provider>,
  );
  return screen.getByTestId("route-loading-skeleton");
}

describe("LazyThreadDetailView", () => {
  it("lays out its loading skeleton as a full page in an unbounded pane", () => {
    const header = renderLoadingPane(false).firstElementChild;

    expect(header?.className).toContain("pl-12");
  });

  it("keeps its loading skeleton inside a bounded split pane", () => {
    const header = renderLoadingPane(true).firstElementChild;

    expect(header?.className).toContain("px-4");
    expect(header?.className).not.toContain("pl-12");
  });
});
