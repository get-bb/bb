// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { MarketplaceLink } from "./cta";
import {
  DelegationTree,
  PluginMorph,
  StartAnywhere,
  useCycle,
} from "./landing-visuals";
import { useActiveWhileVisible } from "./visibility";

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
    const { ref, active } = useActiveWhileVisible<HTMLDivElement>();
    const { cycle, leaving, paused } = useCycle(1000, 100, active);
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
  it("shows bb desktop grouped by machine and the bb mobile app", () => {
    const html = renderToStaticMarkup(<StartAnywhere />);
    for (const text of [
      "Fix CHK-41: checkout hangs on slow networks",
      "src/checkout/pay.ts",
      "linux-box",
      ">server<",
      "MacBook",
      "Fix CI on main",
      "Daily changelog",
      "Explored",
      "Running",
      "pnpm test checkout",
      "Working...",
      "Ask a follow-up",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="mock bw-window"/g)).toHaveLength(1);
    expect(html.match(/class="bw-phone"/g)).toHaveLength(1);
    expect(html).not.toMatch(/bb spawn|fw-arrow|fw-auto|bw-chat/);
  });

  it("shows the thread on its own, with no side panel open", () => {
    const html = renderToStaticMarkup(<StartAnywhere />);
    expect(html).not.toContain("bw-sp");
    expect(html).not.toContain("bar-toggle active");
    expect(html.match(/class="composer"/g)).toHaveLength(1);
    expect(html).toContain("Ask for a follow-up");
    expect(html).toContain(">Codex<");
    const label = html.match(/aria-label="([^"]*)"/)![1]!;
    expect(label).toContain("desktop app");
    expect(label).toContain("iPhone");
    expect(label).not.toMatch(/Diff panel|ChatGPT/);
  });
});

describe("PluginMorph", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function mount(reduce = false) {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    vi.stubGlobal("matchMedia", () => ({ matches: reduce }));
    FakeObserver.instances = [];
    const view = render(<PluginMorph />);
    const root = view.host.querySelector<HTMLElement>(".bw-morph")!;
    const layer = (selector: string) =>
      view.host.querySelector(selector)!.className;
    return { ...view, root, layer };
  }

  it("draws every configuration in one window, starting on a plain thread", () => {
    const html = renderToStaticMarkup(<PluginMorph />);
    for (const text of [
      'role="img"',
      'data-scene="stock"',
      "Fix the checkout bug",
      "Kanban",
      "Start task",
      "Agent graph",
      "Search in files",
      "README.md",
      "Settled (23)",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="mock bw-window mx-window"/g)).toHaveLength(1);
    expect(html.match(/mx-layer is-on/g)).toHaveLength(2);
  });

  it("changes the window's layout on a beat, only while on screen and visible", () => {
    const { root, layer, unmount } = mount();
    act(() => vi.advanceTimersByTime(20_000));
    expect(root.dataset.scene).toBe("stock");

    FakeObserver.instances[0]!.show(true);
    act(() => vi.advanceTimersByTime(1_500));
    expect(root.dataset.scene).toBe("files");
    expect(root.className).toContain("mx-collapsed");
    expect(layer(".mx-center > .main:nth-child(2)")).toContain("is-entering");
    expect(layer(".mx-center > .main:nth-child(1)")).toContain("is-under");
    expect(layer(".mx-side-threads")).toContain("is-under");

    act(() => vi.advanceTimersByTime(1_100));
    expect(layer(".mx-center > .main:nth-child(1)")).not.toContain("is-under");
    expect(layer(".mx-side-threads")).not.toContain("is-on");

    act(() => vi.advanceTimersByTime(2_600));
    expect(root.dataset.scene).toBe("graph");
    expect(root.querySelector(".bar-toggle.active")).not.toBeNull();

    act(() => vi.advanceTimersByTime(3_700));
    expect(root.dataset.scene).toBe("taskboard");
    expect(root.querySelector(".bar-toggle.active")).toBeNull();

    act(() => vi.advanceTimersByTime(3_700));
    expect(root.dataset.scene).toBe("shelves");
    expect(root.className).not.toContain("mx-collapsed");
    expect(layer(".mx-side-shelves")).toContain("is-entering");

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(20_000));
    expect(root.dataset.scene).toBe("shelves");
    expect(root.className).toContain("fw-paused");

    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(1_500));
    expect(root.dataset.scene).toBe("stock");
    unmount();
  });

  it("never shows the same layout twice in a row", () => {
    const { root, unmount } = mount();
    FakeObserver.instances[0]!.show(true);
    const seen: string[] = [];
    const layout = () =>
      [
        root.className.includes("mx-collapsed"),
        root.querySelector(".mx-side-slot .is-on")?.className ?? "",
        root.querySelector(".mx-center .is-on")!.className,
        root.querySelector(".bar-toggle.active") !== null,
      ].join("|");
    seen.push(layout());
    for (let step = 0; step < 5; step += 1) {
      act(() => vi.advanceTimersByTime(3_700));
      seen.push(layout());
    }
    for (let step = 1; step < seen.length; step += 1) {
      expect(seen[step]).not.toBe(seen[step - 1]);
    }
    expect(seen[5]).toBe(seen[0]);
    unmount();
  });

  it("holds one static configuration under reduced motion", () => {
    const { root, unmount } = mount(true);
    FakeObserver.instances[0]!.show(true);
    act(() => vi.advanceTimersByTime(20_000));
    expect(root.dataset.scene).toBe("graph");
    expect(root.querySelector(".is-entering")).toBeNull();
    unmount();
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

describe("below-the-fold bb windows", () => {
  it.each([
    ["PluginMorph", PluginMorph],
    ["DelegationTree", DelegationTree],
    ["StartAnywhere", StartAnywhere],
  ])("%s uses the nav rail and no Commit button", (_, Visual) => {
    const html = renderToStaticMarkup(<Visual />);
    expect(html.match(/class="rail"/g)).toHaveLength(1);
    expect(html).not.toMatch(/Commit|commit-btn|Opus 4\.8/);
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
