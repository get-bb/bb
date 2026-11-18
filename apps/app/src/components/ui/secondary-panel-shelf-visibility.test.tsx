// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setCompactSecondaryPanelPresentation,
  setCompactSecondaryPanelSwipeOpening,
  useFixedChromePanelShelfState,
} from "./secondary-panel-shelf-visibility";

function FixedChrome({ isCompactViewport }: { isCompactViewport: boolean }) {
  const state = useFixedChromePanelShelfState({
    isCompactViewport,
    isSidebarDrawerOpen: false,
  });
  return <div data-testid="fixed-chrome" data-panel-shelf={state} />;
}

afterEach(() => {
  cleanup();
  setCompactSecondaryPanelSwipeOpening(false);
  setCompactSecondaryPanelPresentation("closed");
});

describe("useFixedChromePanelShelfState", () => {
  it("covers fixed chrome while the panel is being swiped open", () => {
    render(<FixedChrome isCompactViewport />);
    const chrome = screen.getByTestId("fixed-chrome");
    expect(chrome.getAttribute("data-panel-shelf")).toBe("closed");

    act(() => setCompactSecondaryPanelSwipeOpening(true));
    expect(chrome.getAttribute("data-panel-shelf")).toBe("full");

    act(() => setCompactSecondaryPanelSwipeOpening(false));
    expect(chrome.getAttribute("data-panel-shelf")).toBe("closed");
  });

  it("leaves wide layouts alone during a swipe", () => {
    render(<FixedChrome isCompactViewport={false} />);
    act(() => setCompactSecondaryPanelSwipeOpening(true));
    expect(
      screen.getByTestId("fixed-chrome").hasAttribute("data-panel-shelf"),
    ).toBe(false);
  });
});
