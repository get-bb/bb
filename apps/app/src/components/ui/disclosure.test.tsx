// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpandablePanel } from "./disclosure";
import { layoutAnimationInFlightCountAtom } from "./layoutAnimationAtoms.js";

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

/**
 * A toggleable panel driven by its own header, like a timeline tool row.
 * With `collapsedContent` it is a row that shows a preview while collapsed.
 */
function TogglablePanel({
  collapsedContent,
}: {
  collapsedContent?: ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  return (
    <ExpandablePanel
      isExpanded={isExpanded}
      summaryContent="Tool call"
      headerToneClass="text-foreground"
      onToggle={() => setIsExpanded((expanded) => !expanded)}
      collapsedContent={collapsedContent}
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
    const body = screen.getByText("Expanded body");

    fireEvent.click(header);

    // The collapse animates from the still-rendered subtree: the same body
    // element stays mounted for the 200ms transition, then unmounts.
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Expanded body")).toBe(body);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Expanded body")).toBeNull();
  });

  it("keeps the preview, its height and the in-flight window until the body's commit", () => {
    // jsdom lays nothing out: stand in a text-length metric so the region's
    // height write tells the preview, an empty body wrapper and the body apart.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.textContent?.length ?? 0;
      },
    );
    vi.useFakeTimers();
    const store = createStore();
    render(
      <Provider store={store}>
        <TogglablePanel collapsedContent={<span>Collapsed summary</span>} />
      </Provider>,
    );
    const header = screen.getByRole("button", { name: "Tool call" });
    const preview = screen.getByText("Collapsed summary");
    const region = preview.parentElement?.parentElement;
    if (!region) {
      throw new Error("Panel body region was not rendered");
    }
    const previewHeight = `${"Collapsed summary".length}px`;
    const bodyHeight = `${"Expanded body".length}px`;
    expect(region.style.height).toBe(previewHeight);

    let toggleCommit: {
      ariaExpanded: string | null;
      previewMounted: boolean;
      height: string;
      transitionDuration: string;
      inFlight: number;
    } | null = null;
    act(() => {
      flushSync(() => {
        header.click();
      });
      toggleCommit = {
        ariaExpanded: header.getAttribute("aria-expanded"),
        previewMounted: preview.isConnected,
        height: region.style.height,
        transitionDuration: region.style.transitionDuration,
        inFlight: store.get(layoutAnimationInFlightCountAtom),
      };
    });

    // The tap's commit flips the caret only. The preview stays on screen at
    // its own height; no tween or in-flight window opens against the empty
    // wrapper the body has not filled yet.
    expect(toggleCommit).toEqual({
      ariaExpanded: "true",
      previewMounted: true,
      height: previewHeight,
      transitionDuration: "0s",
      inFlight: 0,
    });

    // The deferred commit swaps the preview for the body, eases the region
    // toward the body's real height and opens the 200ms in-flight window.
    expect(screen.queryByText("Collapsed summary")).toBeNull();
    expect(screen.getByText("Expanded body")).toBeTruthy();
    expect(region.style.height).toBe(bodyHeight);
    expect(region.style.transitionDuration).toBe("");
    expect(store.get(layoutAnimationInFlightCountAtom)).toBe(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(store.get(layoutAnimationInFlightCountAtom)).toBe(0);
  });

  it("reuses the retained body when a reopen lands inside the close window", () => {
    vi.useFakeTimers();
    render(<TogglablePanel />);
    const header = screen.getByRole("button", { name: "Tool call" });
    fireEvent.click(header);
    const region = screen.getByText("Expanded body").closest("[aria-hidden]");
    if (!region) {
      throw new Error("Panel body region was not rendered");
    }

    fireEvent.click(header);
    expect(region.getAttribute("aria-hidden")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // The element the close window is retaining while it animates out.
    const body = screen.getByText("Expanded body");

    let reopenCommitBody: Element | null = null;
    let reopenCommitAriaHidden: string | null = null;
    act(() => {
      flushSync(() => {
        header.click();
      });
      reopenCommitBody = screen.queryByText("Expanded body");
      reopenCommitAriaHidden = region.getAttribute("aria-hidden");
    });

    // The reopen tap's commit reopens the region around the subtree the close
    // window retained instead of blanking it until the deferred body lands,
    // and that deferred commit reconciles into the same element.
    expect(reopenCommitBody).toBe(body);
    expect(reopenCommitAriaHidden).toBe("false");
    expect(screen.getByText("Expanded body")).toBe(body);

    // The cancelled close no longer unmounts the body when its timer would
    // have fired.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Expanded body")).toBe(body);
  });
});
