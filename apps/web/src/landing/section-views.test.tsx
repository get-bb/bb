// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { Band } from "./landing-visuals";
import {
  SECTION_VIEW_DWELL_MS,
  observeSectionViews,
  useSectionViews,
} from "./section-views";

vi.mock("./analytics", () => ({ trackLandingEvent: vi.fn() }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Callback = (entries: IntersectionObserverEntry[]) => void;

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  constructor(readonly callback: Callback) {
    FakeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
}

const VIEWPORT = 800;

function report(target: Element, ratio: number, height = 400) {
  const observer = FakeObserver.instances.at(-1)!;
  if (!observer.observed.has(target)) return;
  const visible = height * ratio;
  observer.callback([
    {
      target,
      isIntersecting: ratio > 0,
      intersectionRatio: ratio,
      intersectionRect: { height: visible } as DOMRectReadOnly,
      rootBounds: { height: VIEWPORT } as DOMRectReadOnly,
    } as IntersectionObserverEntry,
  ]);
}

function section(id: string) {
  const el = document.createElement("section");
  el.dataset.section = id;
  document.body.appendChild(el);
  return el;
}

describe("observeSectionViews", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeObserver.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("reports a section after it stays 40% visible for a second", () => {
    const logos = section("logos");
    const onView = vi.fn();
    observeSectionViews(document, onView);

    report(logos, 0.4);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS - 1);
    expect(onView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onView).toHaveBeenCalledExactlyOnceWith("logos");
  });

  it("ignores sections that leave before the second is up", () => {
    const closer = section("closer");
    const onView = vi.fn();
    observeSectionViews(document, onView);

    report(closer, 0.6);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS / 2);
    report(closer, 0.2);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS * 2);
    expect(onView).not.toHaveBeenCalled();

    report(closer, 0.5);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS);
    expect(onView).toHaveBeenCalledExactlyOnceWith("closer");
  });

  it("does not count a section under 40% visible", () => {
    const gang = section("gang");
    const onView = vi.fn();
    observeSectionViews(document, onView);

    report(gang, 0.35);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS * 3);
    expect(onView).not.toHaveBeenCalled();
  });

  it("counts a section taller than the screen once it fills 40% of it", () => {
    const tall = section("kick-off");
    const onView = vi.fn();
    observeSectionViews(document, onView);

    report(tall, 0.3, VIEWPORT * 2);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS);
    expect(onView).toHaveBeenCalledExactlyOnceWith("kick-off");
  });

  it("reports each section once per page view", () => {
    const logos = section("logos");
    const forkIt = section("fork-it");
    const onView = vi.fn();
    observeSectionViews(document, onView);

    for (let i = 0; i < 3; i++) {
      report(logos, 1);
      report(forkIt, 1);
      vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS);
      report(logos, 0);
      report(forkIt, 0);
    }
    expect(onView.mock.calls).toEqual([["logos"], ["fork-it"]]);
  });

  it("stops reporting after cleanup", () => {
    const logos = section("logos");
    const onView = vi.fn();
    const stop = observeSectionViews(document, onView);

    report(logos, 1);
    stop();
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS);
    expect(onView).not.toHaveBeenCalled();
  });

  it("tracks each view and hands it to the page's latest callback", () => {
    const logos = section("logos");
    const first = vi.fn();
    const latest = vi.fn();
    function Page({ onView }: { onView: (section: string) => void }) {
      useSectionViews(onView);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(<Page onView={first} />));
    act(() => root.render(<Page onView={latest} />));

    report(logos, 1);
    vi.advanceTimersByTime(SECTION_VIEW_DWELL_MS);
    expect(trackLandingEvent).toHaveBeenCalledExactlyOnceWith({
      name: "landing_section_viewed",
      properties: { section: "logos" },
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith("logos");
    act(() => root.unmount());
  });
});

describe("Band", () => {
  it("carries its section id only when given one", () => {
    expect(
      renderToStaticMarkup(
        <Band title="T" section="gang" visual={null}>
          body
        </Band>,
      ),
    ).toContain('data-section="gang"');
    expect(
      renderToStaticMarkup(
        <Band title="T" visual={null}>
          body
        </Band>,
      ),
    ).not.toContain("data-section");
  });
});
