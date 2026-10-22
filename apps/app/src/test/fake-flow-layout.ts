import { vi } from "vitest";

interface FakeFlowLayoutOptions {
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
  scrollElement: scrollElementOption,
  viewportHeight: initialViewportHeight,
}: FakeFlowLayoutOptions) {
  let viewportHeight = initialViewportHeight;
  let scrollTop = 0;
  const boxes = new Map<Element, Box>();
  const resolveScrollElement = (): HTMLElement | null =>
    typeof scrollElementOption === "function"
      ? scrollElementOption()
      : scrollElementOption;

  const layout = () => {
    boxes.clear();
    const place = (element: Element, top: number): number => {
      const own = element.getAttribute(HEIGHT_ATTRIBUTE);
      const style = element instanceof HTMLElement ? element.style : null;
      const shift = element instanceof HTMLElement ? translateY(element) : 0;
      let height: number;
      if (own !== null) {
        height = Number(own);
        let childTop = top + shift;
        for (const child of element.children) {
          childTop += place(child, childTop);
        }
      } else if (style !== null && style.height !== "") {
        height = pixels(style.height);
      } else {
        const gap = style === null ? 0 : pixels(style.gap);
        let childTop = top + shift;
        let used = 0;
        let index = 0;
        for (const child of element.children) {
          const childHeight = place(child, childTop);
          childTop += childHeight + gap;
          used += childHeight + (index > 0 ? gap : 0);
          index += 1;
        }
        height = used;
      }
      boxes.set(element, { top: top + shift, height });
      return height;
    };
    const scrollElement = resolveScrollElement();
    if (scrollElement === null) return 0;
    let top = 0;
    for (const child of scrollElement.children) top += place(child, top);
    return top;
  };

  const contentHeight = () => Math.max(viewportHeight, layout());
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
      layout();
      const box = boxes.get(this);
      if (box === undefined) return new DOMRect(0, 0, 0, 0);
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
      layout();
      for (const observer of [...observers]) {
        const entries: ResizeObserverEntry[] = [];
        for (const target of observer.targets) {
          const height = boxes.get(target)?.height ?? 0;
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
