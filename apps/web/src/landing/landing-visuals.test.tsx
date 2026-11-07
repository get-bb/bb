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
      "Fix the checkout bug:<br/>payments hang on slow networks",
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
    expect(html.match(/class="mock bw-window mock-ui"/g)).toHaveLength(1);
    expect(html.match(/class="bw-phone"/g)).toHaveLength(1);
    expect(html).not.toMatch(/bb spawn|fw-arrow|fw-auto|bw-chat/);
  });

  it("opens the thread with its prompt already in place on both screens", () => {
    const html = renderToStaticMarkup(<StartAnywhere />);
    const still =
      /<div class="bw-reveal bw-reveal-still"><div class="bw-reveal-inner"><div class="(rhb-user bw-fit-start|bw-m-user)">(<span( class="bw-fit-form bw-fit-0")?>)?Fix the checkout( bug:)?/g;
    expect(html.match(still)).toHaveLength(2);
  });

  it("shows the thread on its own, with no side panel open", () => {
    const html = renderToStaticMarkup(<StartAnywhere />);
    expect(html).not.toContain("bw-sp");
    expect(html).not.toContain("bar-toggle active");
    expect(html.match(/class="rhb-dock-wrap bw-dock"/g)).toHaveLength(1);
    expect(html).toContain("Ask a follow-up");
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

  it("starts on a plain thread in one window", () => {
    const html = renderToStaticMarkup(<PluginMorph />);
    for (const text of [
      'role="img"',
      'data-scene="stock"',
      "Fix the checkout bug",
      "Signups by plan",
    ]) {
      expect(html).toContain(text);
    }
    expect(
      html.match(/class="mock bw-window mx-window mock-ui"/g),
    ).toHaveLength(1);
    expect(html.match(/class="mx-pane /g)).toHaveLength(1);
  });

  it("slides the next setup in on a beat, only while on screen and visible", () => {
    const { root, unmount } = mount();
    const panes = () =>
      [...root.querySelectorAll(".mx-pane")].map((pane) => pane.className);
    const titles = () =>
      [...root.querySelectorAll(".mx-title")].map(
        (title) => `${title.className}: ${title.textContent}`,
      );
    act(() => vi.advanceTimersByTime(20_000));
    expect(root.dataset.scene).toBe("stock");

    FakeObserver.instances[0]!.show(true);
    act(() => vi.advanceTimersByTime(1_050));
    expect(root.dataset.scene).toBe("files");
    expect(panes()).toEqual([
      "mx-pane mx-stock is-leaving",
      "mx-pane mx-files mx-collapsed is-entering",
    ]);
    expect(titles()).toEqual([
      "mx-title is-leaving: Fix the checkout bug",
      "mx-title is-entering: Files",
    ]);

    act(() => vi.advanceTimersByTime(1_400));
    expect(panes()).toEqual(["mx-pane mx-files mx-collapsed"]);
    expect(titles()).toEqual(["mx-title: Files"]);

    act(() => vi.advanceTimersByTime(3_600));
    expect(root.dataset.scene).toBe("graph");
    expect(root.querySelector(".bar-toggle.active")).not.toBeNull();

    act(() => vi.advanceTimersByTime(3_600));
    expect(root.dataset.scene).toBe("taskboard");
    expect(root.querySelector(".bar-toggle.active")).toBeNull();

    act(() => vi.advanceTimersByTime(3_600));
    expect(root.dataset.scene).toBe("shelves");
    expect(panes()).toEqual(["mx-pane mx-shelves"]);

    act(() => vi.advanceTimersByTime(3_600));
    expect(root.dataset.scene).toBe("stock");

    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(20_000));
    expect(root.dataset.scene).toBe("stock");
    expect(root.className).toContain("fw-paused");

    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(1_600));
    expect(root.dataset.scene).toBe("files");
    unmount();
  });

  it("never shows the same layout twice in a row", () => {
    const { root, unmount } = mount();
    FakeObserver.instances[0]!.show(true);
    const seen: string[] = [];
    const layout = () =>
      [
        root.querySelector(".mx-pane")!.className,
        root.querySelector(".mx-side-slot .mx-fill")?.className ?? "",
        root.querySelector(".mx-center .mx-fill")!.firstElementChild!.className,
        root.querySelector(".bar-toggle.active") !== null,
      ].join("|");
    seen.push(layout());
    act(() => vi.advanceTimersByTime(2_600));
    for (let step = 0; step < 5; step += 1) {
      seen.push(layout());
      act(() => vi.advanceTimersByTime(3_600));
    }
    for (let step = 1; step < seen.length; step += 1) {
      expect(seen[step]).not.toBe(seen[step - 1]);
    }
    expect(seen[5]).toBe(seen[0]);
    unmount();
  });

  it("cuts straight to each setup under reduced motion", () => {
    const { root, unmount } = mount(true);
    FakeObserver.instances[0]!.show(true);
    expect(root.dataset.scene).toBe("stock");
    act(() => vi.advanceTimersByTime(2_200));
    expect(root.dataset.scene).toBe("files");
    expect(root.querySelectorAll(".mx-pane")).toHaveLength(1);
    expect(root.querySelector(".mx-pane")!.className).not.toContain("is-");
    expect(root.querySelectorAll(".mx-title")).toHaveLength(1);
    expect(root.querySelector(".mx-title")!.textContent).toBe("Files");
    act(() => vi.advanceTimersByTime(2_200));
    expect(root.dataset.scene).toBe("graph");
    expect(root.querySelectorAll(".mx-pane")).toHaveLength(1);
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
      "bb thread spawn --project $BB_PROJECT_ID --parent-self",
      "Worked for",
      "Sent to",
      "Message from",
    ]) {
      expect(html).toContain(text);
    }
    expect(html.match(/class="rhb-gen"/g)).toHaveLength(5);
    expect(html.match(/rhb-gen-verb">finished/g)).toHaveLength(2);
    expect(html).not.toContain("Child thread updates");
    expect(html.match(/class="bw-toast"/g)).toHaveLength(1);
    expect(html).toContain(">Waiting for your input<");
    expect(html).toContain('class="bw-toast-title">Review the diff<');
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
