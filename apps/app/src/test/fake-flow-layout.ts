import { vi } from "vitest";

interface FakeFlowLayoutOptions {
  heightOf?: (element: Element) => number | null;
  scrollElement: HTMLElement | (() => HTMLElement | null);
  viewportHeight: number;
}

interface Box {
  top: number;
  height: number;
}

type ObserverCallback = (entries: ResizeObserverEntry[]) => void;

const HEIGHT_ATTRIBUTE = "data-fake-height";

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function translateY(element: HTMLElement): number {
  const match = /translate3d\(0(?:px)?, (-?[\d.]+)px/u.exec(
    element.style.transform,
  );
  return match === null ? 0 : Number(match[1]);
}

export function setFakeHeight(element: Element, height: number): void {
  element.setAttribute(HEIGHT_ATTRIBUTE, String(height));
}

export function installFakeFlowLayout({
  heightOf,
  scrollElement: scrollElementOption,
  viewportHeight: initialViewportHeight,
}: FakeFlowLayoutOptions) {
  let viewportHeight = initialViewportHeight;
  let scrollTop = 0;
  let observerSnapshot: Map<Element, number> | null = null;
  const resolveScrollElement = (): HTMLElement | null =>
    typeof scrollElementOption === "function"
      ? scrollElementOption()
      : scrollElementOption;

  const ownHeight = (element: Element): number | null => {
    const attribute = element.getAttribute(HEIGHT_ATTRIBUTE);
    return attribute !== null
      ? Number(attribute)
      : (heightOf?.(element) ?? null);
  };

  const measureHeight = (
    element: Element,
    snapshot?: Map<Element, number>,
  ): number => {
    let height = ownHeight(element);
    const style = element instanceof HTMLElement ? element.style : null;
    if (height === null && style !== null && style.height !== "") {
      height = pixels(style.height);
    } else if (height === null || snapshot !== undefined) {
      const gap = height === null && style !== null ? pixels(style.gap) : 0;
      let used = 0;
      let first = true;
      for (
        let child = element.firstElementChild;
        child !== null;
        child = child.nextElementSibling
      ) {
        used += measureHeight(child, snapshot) + (first ? 0 : gap);
        first = false;
      }
      height ??= used;
    }
    snapshot?.set(element, height);
    return height;
  };

  const measureBox = (element: Element): Box | null => {
    const scrollElement = resolveScrollElement();
    if (scrollElement === null || element === scrollElement) return null;
    let top = 0;
    let current = element;
    while (current !== scrollElement) {
      const parent: Element | null = current.parentElement;
      if (parent === null) return null;
      if (current instanceof HTMLElement) top += translateY(current);
      let gap = 0;
      if (
        parent !== scrollElement &&
        ownHeight(parent) === null &&
        parent instanceof HTMLElement
      ) {
        if (parent.style.height !== "") return null;
        gap = pixels(parent.style.gap);
      }
      for (
        let sibling = parent.firstElementChild;
        sibling !== null && sibling !== current;
        sibling = sibling.nextElementSibling
      ) {
        top += measureHeight(sibling) + gap;
      }
      current = parent;
    }
    return { top, height: measureHeight(element) };
  };

  const measureContentHeight = (snapshot?: Map<Element, number>) => {
    snapshot?.clear();
    let height = 0;
    const scrollElement = resolveScrollElement();
    for (
      let child = scrollElement?.firstElementChild ?? null;
      child !== null;
      child = child.nextElementSibling
    ) {
      height += measureHeight(child, snapshot);
    }
    return height;
  };
  const contentHeight = () =>
    Math.max(
      viewportHeight,
      measureContentHeight(observerSnapshot ?? undefined),
    );
  const maxScrollTop = () => Math.max(0, contentHeight() - viewportHeight);

  const isScrollElement = (element: Element) =>
    element === resolveScrollElement();
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollTop",
  );
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "clientHeight",
  );
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollHeight",
  );
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return isScrollElement(this)
        ? scrollTop
        : (scrollTopDescriptor?.get?.call(this) ?? 0);
    },
    set(this: Element, value: number) {
      if (isScrollElement(this)) {
        scrollTop = Math.min(Math.max(0, value), maxScrollTop());
      } else {
        scrollTopDescriptor?.set?.call(this, value);
      }
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return isScrollElement(this)
        ? viewportHeight
        : (clientHeightDescriptor?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      return isScrollElement(this)
        ? contentHeight()
        : (scrollHeightDescriptor?.get?.call(this) ?? 0);
    },
  });

  const rectSpy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      if (isScrollElement(this)) {
        return new DOMRect(0, 0, 400, viewportHeight);
      }
      if (observerSnapshot !== null) measureContentHeight(observerSnapshot);
      const box = measureBox(this);
      if (box === null) return new DOMRect(0, 0, 0, 0);
      return new DOMRect(0, box.top - scrollTop, 400, box.height);
    });

  const observers = new Set<{
    callback: ObserverCallback;
    targets: Set<Element>;
    sizes: Map<Element, number>;
  }>();
  const OriginalResizeObserver = globalThis.ResizeObserver;
  class FakeResizeObserver {
    private readonly record: {
      callback: ObserverCallback;
      targets: Set<Element>;
      sizes: Map<Element, number>;
    };
    constructor(callback: ObserverCallback) {
      this.record = { callback, targets: new Set(), sizes: new Map() };
      observers.add(this.record);
    }
    observe(target: Element) {
      this.record.targets.add(target);
    }
    unobserve(target: Element) {
      this.record.targets.delete(target);
      this.record.sizes.delete(target);
    }
    disconnect() {
      this.record.targets.clear();
      observers.delete(this.record);
    }
  }
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;

  return {
    get scrollTop() {
      return scrollTop;
    },
    maxScrollTop,
    userScrollTo(value: number) {
      const scrollElement = resolveScrollElement();
      if (scrollElement === null) throw new Error("No scroll element");
      const next = Math.min(Math.max(0, value), maxScrollTop());
      scrollElement.dispatchEvent(
        new WheelEvent("wheel", { deltaY: next - scrollTop }),
      );
      scrollTop = next;
      scrollElement.dispatchEvent(new Event("scroll"));
    },
    topOf(element: Element): number {
      return element.getBoundingClientRect().top;
    },
    flushResizeObservers() {
      const previousSnapshot = observerSnapshot;
      const heights = previousSnapshot ?? new Map<Element, number>();
      observerSnapshot = heights;
      try {
        measureContentHeight(heights);
        for (const observer of [...observers]) {
          const entries: ResizeObserverEntry[] = [];
          for (const target of observer.targets) {
            const height = heights.get(target) ?? 0;
            if (observer.sizes.get(target) === height) continue;
            observer.sizes.set(target, height);
            entries.push({
              target,
              borderBoxSize: [{ blockSize: height, inlineSize: 400 }],
              contentBoxSize: [{ blockSize: height, inlineSize: 400 }],
              contentRect: new DOMRect(0, 0, 400, height),
              devicePixelContentBoxSize: [],
            });
          }
          if (entries.length > 0) {
            observer.callback(entries);
          }
        }
      } finally {
        observerSnapshot = previousSnapshot;
      }
    },
    setViewportHeight(height: number) {
      viewportHeight = height;
    },
    bounceTo(value: number) {
      scrollTop = value;
    },
    layoutScrollTo(value: number) {
      const scrollElement = resolveScrollElement();
      if (scrollElement === null) throw new Error("No scroll element");
      scrollTop = Math.min(Math.max(0, value), maxScrollTop());
      scrollElement.dispatchEvent(new Event("scroll"));
    },
    restore() {
      rectSpy.mockRestore();
      for (const [name, descriptor] of [
        ["scrollTop", scrollTopDescriptor],
        ["clientHeight", clientHeightDescriptor],
        ["scrollHeight", scrollHeightDescriptor],
      ] as const) {
        if (descriptor !== undefined) {
          Object.defineProperty(Element.prototype, name, descriptor);
        }
      }
      globalThis.ResizeObserver = OriginalResizeObserver;
    },
  };
}
