// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandablePanel } from "./disclosure";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

afterEach(() => {
  ResizeObserverStub.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderPanel(isExpanded: boolean) {
  return render(
    <ExpandablePanel
      isExpanded={isExpanded}
      summaryContent="Tool call"
      headerToneClass="text-foreground"
      collapsedContent={<span>Collapsed summary</span>}
    >
      <span>Expanded body</span>
    </ExpandablePanel>,
  );
}

function fireResize(): void {
  const observer = ResizeObserverStub.instances.at(-1);
  if (!observer) {
    throw new Error("No ResizeObserver was installed");
  }
  act(() => {
    observer.callback([], observer);
  });
}

describe("ExpandablePanel body height", () => {
  it("snaps content growth inside an open body but eases the toggle", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const view = renderPanel(true);
    const region =
      view.getByText("Expanded body").parentElement?.parentElement
        ?.parentElement;
    if (!region) {
      throw new Error("Panel body region was not rendered");
    }

    // Mount is not a toggle: no easing.
    expect(region.style.transitionDuration).toBe("0s");

    // A streaming delta grows the open body: still no easing, so the region
    // does not restart a 200ms tween per delta under the timeline's
    // AutoHeightContainer.
    fireResize();
    expect(region.style.transitionDuration).toBe("0s");

    // An expand/collapse toggle restores the class-driven 200ms ease.
    view.rerender(
      <ExpandablePanel
        isExpanded={false}
        summaryContent="Tool call"
        headerToneClass="text-foreground"
        collapsedContent={<span>Collapsed summary</span>}
      >
        <span>Expanded body</span>
      </ExpandablePanel>,
    );
    expect(region.style.transitionDuration).toBe("");

    // Growth after the toggle window is over snaps again.
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 10_000);
    fireResize();
    expect(region.style.transitionDuration).toBe("0s");
  });
});

/** A toggleable panel driven by its own header, like a timeline tool row. */
function TogglablePanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      summaryContent="Tool call"
      headerToneClass="text-foreground"
      onToggle={() => setIsExpanded((expanded) => !expanded)}
    >
      <span>Expanded body</span>
    </ExpandablePanel>
  );
}

describe("ExpandablePanel deferred body realization", () => {
  it("flips the caret in the tap's commit and mounts the body in a deferred one", () => {
    render(<TogglablePanel />);
    const header = screen.getByRole("button", { name: "Tool call" });

    let bodyMountedInToggleCommit: boolean | null = null;
    let headerExpandedInToggleCommit: string | null = null;
    act(() => {
      // flushSync stands in for the tap's discrete event: it flushes only the
      // urgent lane, so the deferred body re-render is still pending when the
      // samples are taken and lands when act exits.
      flushSync(() => {
        header.click();
      });
      bodyMountedInToggleCommit = screen.queryByText("Expanded body") !== null;
      headerExpandedInToggleCommit = header.getAttribute("aria-expanded");
    });

    // The tap's synchronous commit flips the caret without paying for the
    // body subtree; the body lands in the follow-up interruptible commit.
    expect(headerExpandedInToggleCommit).toBe("true");
    expect(bodyMountedInToggleCommit).toBe(false);
    expect(screen.getByText("Expanded body")).toBeTruthy();
  });

  it("keeps the closing body mounted through the collapse animation", () => {
    vi.useFakeTimers();
    render(<TogglablePanel />);
    const header = screen.getByRole("button", { name: "Tool call" });
    fireEvent.click(header);
    expect(screen.getByText("Expanded body")).toBeTruthy();

    fireEvent.click(header);

    // The collapse animates from the still-rendered subtree: the body must
    // stay mounted for the 200ms transition, then unmount.
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Expanded body")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Expanded body")).toBeNull();
  });
});
