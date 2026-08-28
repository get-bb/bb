/// <reference types="vitest/jsdom" />

import "@bb/shared-ui/icon-extended";

type RuntimeWindow = Omit<
  Window,
  "IntersectionObserver" | "ResizeObserver" | "matchMedia"
> & {
  IntersectionObserver?: typeof IntersectionObserver;
  ResizeObserver?: typeof ResizeObserver;
  matchMedia?: Window["matchMedia"];
};

function readGlobalProperty<T>(name: string): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return descriptor?.get?.call(globalThis) ?? descriptor?.value;
}

const runtimeNavigator = readGlobalProperty<Navigator>("navigator");
const runtimeWindow = readGlobalProperty<RuntimeWindow>("window");
const runtimeElement = readGlobalProperty<typeof Element>("Element");
const runtimeText = readGlobalProperty<typeof Text>("Text");
const runtimeRange = readGlobalProperty<typeof Range>("Range");
const runtimeDocument = readGlobalProperty<Document>("document");
const runtimeJsdom = readGlobalProperty<{ window: Window }>("jsdom");

if (runtimeNavigator === undefined) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node" },
  });
}

if (runtimeWindow !== undefined && runtimeJsdom !== undefined) {
  Object.defineProperty(runtimeWindow, "localStorage", {
    configurable: true,
    value: runtimeJsdom.window.localStorage,
  });
  Object.defineProperty(runtimeWindow, "sessionStorage", {
    configurable: true,
    value: runtimeJsdom.window.sessionStorage,
  });
}

if (runtimeWindow !== undefined && runtimeWindow.matchMedia === undefined) {
  runtimeWindow.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (runtimeWindow !== undefined && !("ResizeObserver" in runtimeWindow)) {
  runtimeWindow.ResizeObserver = class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (
  runtimeElement !== undefined &&
  Object.getOwnPropertyDescriptor(
    runtimeElement.prototype,
    "scrollIntoView",
  ) === undefined
) {
  runtimeElement.prototype.scrollIntoView =
    function scrollIntoViewPolyfill() {};
}

if (
  runtimeElement !== undefined &&
  Object.getOwnPropertyDescriptor(
    runtimeElement.prototype,
    "getClientRects",
  ) === undefined
) {
  Object.defineProperty(runtimeElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  runtimeElement !== undefined &&
  Object.getOwnPropertyDescriptor(
    runtimeElement.prototype,
    "getBoundingClientRect",
  ) === undefined
) {
  Object.defineProperty(runtimeElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  runtimeText !== undefined &&
  Object.getOwnPropertyDescriptor(runtimeText.prototype, "getClientRects") ===
    undefined
) {
  Object.defineProperty(runtimeText.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  runtimeText !== undefined &&
  Object.getOwnPropertyDescriptor(
    runtimeText.prototype,
    "getBoundingClientRect",
  ) === undefined
) {
  Object.defineProperty(runtimeText.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  runtimeRange !== undefined &&
  Object.getOwnPropertyDescriptor(runtimeRange.prototype, "getClientRects") ===
    undefined
) {
  Object.defineProperty(runtimeRange.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  runtimeRange !== undefined &&
  Object.getOwnPropertyDescriptor(
    runtimeRange.prototype,
    "getBoundingClientRect",
  ) === undefined
) {
  Object.defineProperty(runtimeRange.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  runtimeDocument !== undefined &&
  Object.getOwnPropertyDescriptor(runtimeDocument, "elementFromPoint") ===
    undefined
) {
  runtimeDocument.elementFromPoint = function elementFromPointPolyfill() {
    return runtimeDocument.body;
  };
}

if (runtimeWindow !== undefined && !("IntersectionObserver" in runtimeWindow)) {
  class IntersectionObserverPolyfill {
    constructor(
      _callback: IntersectionObserverCallback,
      _options?: IntersectionObserverInit,
    ) {}
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly scrollMargin: string = "";
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  runtimeWindow.IntersectionObserver = IntersectionObserverPolyfill;
}
