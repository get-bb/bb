// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AutoHeightContainer,
  AutoHeightSnapContext,
  HeightTransition,
} from "./height-transition";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  ResizeObserverStub.instances.length = 0;
  frames.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function flushFrame() {
  const batch = [...frames.keys()];
  act(() => {
    for (const id of batch) {
      const callback = frames.get(id);
      frames.delete(id);
      callback?.(0);
    }
  });
}

function deliver(inner: Element, height: number, width = 200) {
  const observer = ResizeObserverStub.instances.at(-1);
  if (!observer) throw new Error("No ResizeObserver was installed");
  act(() =>
    observer.callback(
      [makeResizeEntry(inner, height, height - 8, width)],
      observer,
    ),
  );
}

function fakeTimeouts() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

describe("HeightTransition", () => {
  it("pauses descendant animations while preserving collapsed content state", () => {
    const view = render(
      <HeightTransition visible={false}>
        <span data-testid="animated-child">Working...</span>
      </HeightTransition>,
    );

    const child = view.getByTestId("animated-child");
    const wrapper = child.parentElement?.parentElement;
    expect(wrapper?.className).toContain(
      "[&_*]:![animation-play-state:paused]",
    );

    view.rerender(
      <HeightTransition visible>
        <span data-testid="animated-child">Working...</span>
      </HeightTransition>,
    );

    expect(view.getByTestId("animated-child")).toBe(child);
    expect(wrapper?.className).not.toContain(
      "[&_*]:![animation-play-state:paused]",
    );
  });

  it("snap-syncs its height after a mobile pageshow restore", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(40);
    const view = render(
      <HeightTransition visible>
        <span data-testid="restored-child">Restored content</span>
      </HeightTransition>,
    );
    const wrapper =
      view.getByTestId("restored-child").parentElement?.parentElement;

    expect(wrapper?.style.height).toBe("40px");
    offsetHeight.mockReturnValue(80);

    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(wrapper?.style.height).toBe("80px");
    expect(wrapper?.style.transitionDuration).toBe("0s");
  });

  it("retains width snap intent across a burst while using the latest height", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 40),
    );
    const view = render(
      <HeightTransition visible>
        <span>Working</span>
      </HeightTransition>,
    );
    const inner = view.getByText("Working").parentElement;
    const wrapper = inner?.parentElement;
    if (!inner || !wrapper) throw new Error("HeightTransition did not render");
    deliver(inner, 40);
    flushFrame();
    deliver(inner, 100, 300);
    deliver(inner, 120, 300);
    expect(wrapper.style.height).toBe("40px");
    flushFrame();
    expect(wrapper.style.height).toBe("120px");
    expect(wrapper.style.transitionDuration).toBe("0s");
    flushFrame();
    expect(wrapper.style.transitionDuration).toBe("");
    deliver(inner, 140, 300);
    flushFrame();
    expect(wrapper.style.height).toBe("140px");
    expect(wrapper.style.transitionDuration).toBe("");
  });

  it("discards pending expansion on collapse and remeasures stale restore deliveries", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(40);
    const view = render(
      <HeightTransition visible>
        <span>Working</span>
      </HeightTransition>,
    );
    const inner = view.getByText("Working").parentElement;
    const wrapper = inner?.parentElement;
    if (!inner || !wrapper) throw new Error("HeightTransition did not render");
    deliver(inner, 120);
    view.rerender(
      <HeightTransition visible={false}>
        <span>Working</span>
      </HeightTransition>,
    );
    expect(wrapper.style.height).toBe("0px");
    flushFrame();
    expect(wrapper.style.height).toBe("0px");
    height.mockReturnValue(80);
    view.rerender(
      <HeightTransition visible>
        <span>Working</span>
      </HeightTransition>,
    );
    expect(wrapper.style.height).toBe("80px");
    deliver(inner, 10);
    height.mockReturnValue(100);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(wrapper.style.height).toBe("100px");
    deliver(inner, 20);
    deliver(inner, 30);
    flushFrame();
    expect(wrapper.style.height).toBe("100px");
    expect(wrapper.style.transitionDuration).toBe("0s");
    view.unmount();
    expect(frames.size).toBe(0);
  });
});

function makeResizeEntry(
  target: Element,
  borderBoxBlockSize: number,
  contentRectHeight: number,
  width = 200,
): ResizeObserverEntry {
  return {
    target,
    contentRect: new DOMRect(0, 0, width - 20, contentRectHeight),
    borderBoxSize: [{ blockSize: borderBoxBlockSize, inlineSize: width }],
    contentBoxSize: [{ blockSize: contentRectHeight, inlineSize: width - 20 }],
    devicePixelContentBoxSize: [
      { blockSize: borderBoxBlockSize, inlineSize: width },
    ],
  };
}

function renderAuto(snapRevision = "active") {
  const view = render(
    <AutoHeightContainer snapRevision={snapRevision}>
      <span>Streaming response</span>
    </AutoHeightContainer>,
  );
  const inner = view.getByText("Streaming response").parentElement;
  const wrapper = inner?.parentElement;
  if (!inner || !wrapper) throw new Error("AutoHeightContainer did not render");
  return { view, inner, wrapper };
}

describe("AutoHeightContainer", () => {
  it("sizes the wrapper from the observed border box", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);

    const view = render(
      <AutoHeightContainer>
        <span>Streaming response</span>
      </AutoHeightContainer>,
    );
    const inner = view.getByText("Streaming response").parentElement;
    const wrapper = inner?.parentElement;
    const observer = ResizeObserverStub.instances[0];
    if (!inner || !wrapper || !observer) {
      throw new Error("AutoHeightContainer did not render");
    }

    act(() => {
      observer.callback([makeResizeEntry(inner, 120, 112)], observer);
    });
    expect(wrapper.style.height).toBe("0px");
    flushFrame();
    expect(wrapper.style.height).toBe("120px");
  });

  it("snap-syncs an authoritative layout revision and supersedes stale entries until commit", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 220, 480),
    );
    const view = render(
      <AutoHeightContainer snapRevision="active">
        <span>Streaming response</span>
      </AutoHeightContainer>,
    );
    const inner = view.getByText("Streaming response").parentElement;
    const wrapper = inner?.parentElement;
    const observer = ResizeObserverStub.instances[0];
    expect(inner).not.toBeNull();
    expect(wrapper?.style.height).toBe("0px");
    expect(observer).toBeDefined();
    if (!inner) throw new Error("AutoHeightContainer did not render");
    deliver(inner, 120);
    Object.defineProperty(inner, "offsetHeight", {
      configurable: true,
      value: 480,
    });
    view.rerender(
      <AutoHeightContainer snapRevision="completed-turn:1:2000">
        <span>Completed response</span>
      </AutoHeightContainer>,
    );

    expect(wrapper?.style.height).toBe("480px");
    expect(wrapper?.style.transitionDuration).toBe("0s");
    expect(ResizeObserverStub.instances).toEqual([observer]);
    expect(observer?.disconnect).not.toHaveBeenCalled();
    deliver(inner, 10, 200);
    deliver(inner, 20, 200);
    flushFrame();
    expect(wrapper?.style.height).toBe("480px");
    deliver(inner, 520, 220);
    flushFrame();
    expect(wrapper?.style.height).toBe("520px");
  });

  it.each(["focus", "pageshow", "visibilitychange"])(
    "keeps %s restoration synchronous and authoritative over pending heights",
    (event) => {
      vi.stubGlobal("ResizeObserver", ResizeObserverStub);
      const height = vi
        .spyOn(HTMLElement.prototype, "offsetHeight", "get")
        .mockReturnValue(40);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 0, 200, 40),
      );
      const { inner, wrapper } = renderAuto();
      deliver(inner, 120);
      height.mockReturnValue(480);
      act(() =>
        (event === "visibilitychange" ? document : window).dispatchEvent(
          new Event(event),
        ),
      );
      expect(wrapper.style.height).toBe("480px");
      expect(wrapper.style.transitionDuration).toBe("0s");
      deliver(inner, 10);
      deliver(inner, 20);
      flushFrame();
      expect(wrapper.style.height).toBe("480px");
    },
  );

  it("settles context snaps before the caller scrolls and accepts a genuinely newer width", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(40);
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 200, 40));
    const heightsAtScroll: string[] = [];
    function ScrollControl() {
      const snap = useContext(AutoHeightSnapContext);
      return (
        <button
          onClick={(event) => {
            snap?.();
            heightsAtScroll.push(
              event.currentTarget.parentElement?.parentElement?.style.height ??
                "missing",
            );
          }}
        >
          Scroll
        </button>
      );
    }
    const view = render(
      <AutoHeightContainer>
        <ScrollControl />
      </AutoHeightContainer>,
    );
    const inner = view.getByText("Scroll").parentElement;
    const wrapper = inner?.parentElement;
    if (!inner || !wrapper)
      throw new Error("AutoHeightContainer did not render");
    deliver(inner, 120);
    height.mockReturnValue(480);
    fireEvent.click(view.getByText("Scroll"));
    expect(heightsAtScroll).toEqual(["480px"]);
    deliver(inner, 10);
    bounds.mockReturnValue(new DOMRect(0, 0, 300, 480));
    deliver(inner, 20);
    flushFrame();
    expect(wrapper.style.height).toBe("auto");
    expect(wrapper.style.transitionDuration).toBe("0s");
  });

  it("preserves a consumed initial-settle snap across the deadline, then eases growth and snaps shrinkage", () => {
    fakeTimeouts();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    stubMediaQueries(new Set());
    stubScrollAnchoringSupport(true);
    const { inner, wrapper } = renderAuto();
    deliver(inner, 120);
    act(() => vi.advanceTimersByTime(250));
    deliver(inner, 160);
    flushFrame();
    expect(wrapper.style.height).toBe("160px");
    expect(wrapper.style.transitionDuration).toBe("0s");
    flushFrame();
    deliver(inner, 180);
    flushFrame();
    expect(wrapper.style.height).toBe("180px");
    expect(wrapper.style.transitionDuration).toBe("");
    expect(wrapper.style.transition).toContain("height 180ms");
    deliver(inner, 150);
    flushFrame();
    expect(wrapper.style.height).toBe("150px");
    expect(wrapper.style.transitionDuration).toBe("0s");
  });

  it("restarts initial settling at commit rather than measurement", () => {
    fakeTimeouts();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const { inner, wrapper } = renderAuto();
    act(() => vi.advanceTimersByTime(200));
    deliver(inner, 100);
    flushFrame();
    flushFrame();
    act(() => vi.advanceTimersByTime(100));
    deliver(inner, 140);
    flushFrame();
    expect(wrapper.style.height).toBe("140px");
    expect(wrapper.style.transitionDuration).toBe("0s");
    flushFrame();
    act(() => vi.advanceTimersByTime(250));
    deliver(inner, 160);
    flushFrame();
    expect(wrapper.style.transitionDuration).toBe("");
  });

  it("retains intrinsic intent across A-to-B-to-A width bursts and lets the settle snap supersede queued work", () => {
    fakeTimeouts();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 280),
    );
    const { inner, wrapper } = renderAuto();
    deliver(inner, 100);
    flushFrame();
    flushFrame();
    deliver(inner, 160, 300);
    deliver(inner, 180, 200);
    deliver(inner, 200, 200);
    flushFrame();
    expect(wrapper.style.height).toBe("auto");
    expect(wrapper.style.transitionDuration).toBe("0s");
    act(() => vi.advanceTimersByTime(119));
    expect(wrapper.style.height).toBe("auto");
    deliver(inner, 220, 200);
    height.mockReturnValue(480);
    act(() => vi.advanceTimersByTime(1));
    expect(wrapper.style.height).toBe("480px");
    flushFrame();
    expect(wrapper.style.height).toBe("480px");
    deliver(inner, 20, 300);
    deliver(inner, 30, 300);
    flushFrame();
    expect(wrapper.style.height).toBe("480px");
  });

  it("cancels observation, queued geometry, transition restoration and timers on unmount", () => {
    fakeTimeouts();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const readHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(40);
    const { view, inner, wrapper } = renderAuto();
    deliver(inner, 120);
    flushFrame();
    deliver(inner, 140, 300);
    flushFrame();
    deliver(inner, 160, 300);
    view.unmount();
    const detachedHeight = wrapper.style.height;
    readHeight.mockClear();
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      vi.advanceTimersByTime(1000);
    });
    deliver(inner, 500);
    flushFrame();
    expect(wrapper.style.height).toBe(detachedHeight);
    expect(readHeight).not.toHaveBeenCalled();
  });
});

function stubMediaQueries(matching: ReadonlySet<string>): void {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: matching.has(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function stubScrollAnchoringSupport(supported: boolean): void {
  vi.stubGlobal("CSS", {
    supports: (property: string, value: string) =>
      supported && property === "overflow-anchor" && value === "none",
  });
}

describe("AutoHeightContainer growth easing", () => {
  function renderWrapper(): HTMLElement {
    const view = render(
      <AutoHeightContainer>
        <span>Streaming response</span>
      </AutoHeightContainer>,
    );
    const wrapper =
      view.getByText("Streaming response").parentElement?.parentElement;
    if (!wrapper) {
      throw new Error("AutoHeightContainer wrapper was not rendered");
    }
    return wrapper;
  }

  it("eases growth on a fine pointer with scroll anchoring available", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    stubMediaQueries(new Set());
    stubScrollAnchoringSupport(true);

    expect(renderWrapper().style.transition).toContain("height 180ms");
  });

  it("snaps growth on a coarse pointer", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    stubMediaQueries(new Set(["(pointer: coarse)"]));
    stubScrollAnchoringSupport(true);

    expect(renderWrapper().style.transition).toContain("height 0ms");
  });

  it("snaps growth under reduced motion", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    stubMediaQueries(new Set(["(prefers-reduced-motion: reduce)"]));
    stubScrollAnchoringSupport(true);

    expect(renderWrapper().style.transition).toContain("height 0ms");
  });

  it("snaps growth where the browser has no scroll anchoring", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    stubMediaQueries(new Set());
    stubScrollAnchoringSupport(false);

    expect(renderWrapper().style.transition).toContain("height 0ms");
  });
});
