// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { MarketplaceLink } from "./cta";
import {
  DelegationTree,
  PluginMap,
  StartAnywhere,
  useCycle,
} from "./landing-visuals";

vi.mock("./analytics", () => ({ trackLandingEvent: vi.fn() }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class FakeObserver {
  static instances: FakeObserver[] = [];
  constructor(
    readonly callback: (entries: Partial<IntersectionObserverEntry>[]) => void,
  ) {
    FakeObserver.instances.push(this);
  }
  observe() {}
  disconnect() {}
  show(isIntersecting: boolean) {
    act(() => this.callback([{ isIntersecting }]));
  }
  showBatch(...states: boolean[]) {
    act(() =>
      this.callback(states.map((isIntersecting) => ({ isIntersecting }))),
    );
  }
}

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("useCycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    FakeObserver.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function Watched() {
    const ref = useRef<HTMLDivElement>(null);
    const { cycle, leaving, paused } = useCycle(1000, 100, ref);
    return (
      <div ref={ref} data-cycle={cycle} data-paused={paused}>
        {leaving ? "leaving" : "holding"}
      </div>
    );
  }

  function Unwatched() {
    const { cycle } = useCycle(1000, 100);
    return <div data-cycle={cycle} />;
  }

  const cycleOf = (host: HTMLElement) =>
    Number(host.querySelector("[data-cycle]")!.getAttribute("data-cycle"));

  it("loops from mount without a ref, as before", () => {
    const { host, unmount } = render(<Unwatched />);
    expect(FakeObserver.instances).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1100));
    expect(cycleOf(host)).toBe(1);
    act(() => vi.advanceTimersByTime(1100));
    expect(cycleOf(host)).toBe(2);
    unmount();
  });

  it("only loops while the element is on screen", () => {
    const { host, unmount } = render(<Watched />);
    const observer = FakeObserver.instances[0]!;
    const paused = () =>
      host.querySelector("[data-cycle]")!.getAttribute("data-paused");

    act(() => vi.advanceTimersByTime(5000));
    expect(cycleOf(host)).toBe(0);
    expect(paused()).toBe("true");

    observer.show(true);
    const entered = cycleOf(host);
    expect(entered).toBe(1);
    expect(paused()).toBe("false");
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe("leaving");
    act(() => vi.advanceTimersByTime(100));
    expect(cycleOf(host)).toBe(entered + 1);

    observer.show(false);
    expect(paused()).toBe("true");
    act(() => vi.advanceTimersByTime(5000));
    expect(cycleOf(host)).toBe(entered + 1);

    observer.show(true);
    expect(cycleOf(host)).toBe(entered + 2);
    expect(host.textContent).toBe("holding");
    unmount();
  });

  it("follows the latest entry when a fast scroll batches several", () => {
    const { host, unmount } = render(<Watched />);
    const observer = FakeObserver.instances[0]!;
    const paused = () =>
      host.querySelector("[data-cycle]")!.getAttribute("data-paused");

    observer.showBatch(true, false);
    expect(paused()).toBe("true");
    act(() => vi.advanceTimersByTime(5000));
    expect(cycleOf(host)).toBe(0);

    observer.showBatch(false, true);
    expect(paused()).toBe("false");
    expect(cycleOf(host)).toBe(1);
    unmount();
  });

  it("holds still under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { host, unmount } = render(<Watched />);
    FakeObserver.instances[0]!.show(true);
    act(() => vi.advanceTimersByTime(5000));
    expect(cycleOf(host)).toBe(0);
    unmount();
  });
});

describe("StartAnywhere", () => {
  it("shows a ChatGPT handoff, a sidebar grouped by machine and the phone", () => {
    const html = renderToStaticMarkup(<StartAnywhere />);
    for (const text of [
      ">ChatGPT<",
      "Claude<",
      "Grok<",
      "Hand this off to bb: fix the checkout bug",
      "Control bb",
      "linux-box",
      ">server<",
      "MacBook",
      "Fix CI on main",
      "Daily changelog",
      "Reply to this thread",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="mock bw-window"/g)).toHaveLength(1);
    expect(html).not.toMatch(/bb spawn|fw-arrow|fw-auto/);
  });
});

describe("PluginMap", () => {
  it("shows plugin UI in place in one bb window", () => {
    const html = renderToStaticMarkup(<PluginMap />);
    for (const text of [
      "Checks passed",
      "#482",
      "Weekly signups",
      "Send later",
      "Pull requests",
      "Checkout times out on slow networks",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="bw-spot-tag"/g)).toHaveLength(4);
    expect(html.match(/class="mock bw-window"/g)).toHaveLength(1);
  });
});

describe("DelegationTree", () => {
  it("shows the lead, its three children, their updates and one ping", () => {
    const html = renderToStaticMarkup(<DelegationTree />);
    for (const text of [
      "Ship the checkout fix",
      "Plan the fix",
      "Build it",
      "Review the diff",
      "Claude Code",
      "Cursor",
      "Codex",
      "Grok Build",
      "Replied to <strong>Build it</strong>",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/Child thread updates/g)).toHaveLength(4);
    expect(html.match(/class="bw-toast"/g)).toHaveLength(1);
    expect(html).toContain("Review the diff needs your approval");
  });
});

describe("MarketplaceLink", () => {
  afterEach(() => {
    vi.mocked(trackLandingEvent).mockClear();
    document.body.replaceChildren();
  });

  it("opens the marketplace and reports its placement", () => {
    const { host, unmount } = render(
      <MarketplaceLink placement="customize">Browse plugins</MarketplaceLink>,
    );
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/marketplace");
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(trackLandingEvent).toHaveBeenCalledExactlyOnceWith({
      name: "landing_marketplace_clicked",
      properties: { placement: "customize" },
    });
    unmount();
  });
});
