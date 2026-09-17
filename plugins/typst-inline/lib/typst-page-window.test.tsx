// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TypstSheet } from "../components/typst-sheet";
import type { TypstPage } from "./typst-pages";

interface FakeEntry {
  isIntersecting: boolean;
  target: Element;
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [];
  private readonly callback: IntersectionObserverCallback;
  private observed = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.root = (options?.root ?? null) as Element | Document | null;
    this.rootMargin = options?.rootMargin ?? "0px";
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: FakeEntry[]): void {
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }

  targets(): Element[] {
    return [...this.observed];
  }
}

function observerWithMargin(margin: string): FakeIntersectionObserver {
  const observer = FakeIntersectionObserver.instances.find(
    (candidate) => candidate.rootMargin === margin,
  );
  if (observer === undefined) {
    throw new Error(`No observer with rootMargin ${margin}`);
  }
  return observer;
}

const PAGES: TypstPage[] = [
  {
    heightPt: 100,
    svg: '<svg class="typst-doc" data-page="0"></svg>',
    widthPt: 200,
  },
  {
    heightPt: 100,
    svg: '<svg class="typst-doc" data-page="1"></svg>',
    widthPt: 200,
  },
];

function renderSheet(pages: readonly TypstPage[] = PAGES) {
  return render(<TypstSheet pages={pages} viewportClassName="overflow-auto" />);
}

function slots(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[data-typst-page-slot]")];
}

function renderedPageIndexes(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-typst-page] svg")].map(
    (element) => element.getAttribute("data-page") ?? "",
  );
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TypstSheet", () => {
  it("mounts no page svg until the observer reports it visible", () => {
    const { container } = renderSheet();

    expect(slots(container)).toHaveLength(2);
    expect(renderedPageIndexes(container)).toEqual([]);

    const [first] = slots(container);
    act(() => {
      observerWithMargin("500px 0px").emit([
        { isIntersecting: true, target: first! },
      ]);
    });

    expect(renderedPageIndexes(container)).toEqual(["0"]);
  });

  it("unmounts a page once it leaves the keep margin", () => {
    const { container } = renderSheet();
    const [first, second] = slots(container);
    act(() => {
      observerWithMargin("500px 0px").emit([
        { isIntersecting: true, target: first! },
        { isIntersecting: true, target: second! },
      ]);
    });
    expect(renderedPageIndexes(container)).toEqual(["0", "1"]);

    act(() => {
      observerWithMargin("1500px 0px").emit([
        { isIntersecting: false, target: first! },
      ]);
    });

    expect(renderedPageIndexes(container)).toEqual(["1"]);
  });

  it("observes every page slot in both observers", () => {
    const { container } = renderSheet();

    expect(observerWithMargin("500px 0px").targets()).toHaveLength(2);
    expect(observerWithMargin("1500px 0px").targets()).toHaveLength(2);
    expect(slots(container)).toHaveLength(2);
  });

  it("mounts every page when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = renderSheet();

    expect(renderedPageIndexes(container)).toEqual(["0", "1"]);
  });
});
