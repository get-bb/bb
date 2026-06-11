/// <reference types="vitest/jsdom" />

/**
 * Shared vitest setup.
 *
 * jsdom doesn't implement `window.matchMedia`, `ResizeObserver`,
 * `IntersectionObserver`, or `Element.scrollIntoView`. Several of our hooks and
 * detail blocks (`useMediaQuery`, `useHoverPopover`, `ToolCallDetailBlock`
 * overflow probe, `GitDiffCard` sticky-header sentinel,
 * `SecondaryPanelTabStrip` active-tab auto-scroll) reach for them during mount;
 * without polyfills they throw in every test that indirectly renders such a
 * component.
 */

// `@pierre/diffs` (and similar browser-oriented deps) read `navigator.userAgent`
// at module load. Node < 21 has no global `navigator`, so node-environment tests
// that transitively import them crash on load. Provide a minimal stub when one
// isn't already present (jsdom/browser envs supply a real navigator).
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node" },
  });
}

if (typeof window !== "undefined" && typeof jsdom !== "undefined") {
  /**
   * Node 26 defines global storage accessors. Vitest keeps existing globals
   * when it overlays jsdom, then aliases `window` to `globalThis`, so browser
   * tests need the jsdom storage objects restored explicitly.
   */
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: jsdom.window.localStorage,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: jsdom.window.sessionStorage,
  });
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
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

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollIntoView !== "function"
) {
  Element.prototype.scrollIntoView = function scrollIntoViewPolyfill() {};
}

if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.getClientRects !== "function"
) {
  Object.defineProperty(Element.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.getBoundingClientRect !== "function"
) {
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  typeof Text !== "undefined" &&
  !("getClientRects" in Text.prototype)
) {
  Object.defineProperty(Text.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  typeof Text !== "undefined" &&
  !("getBoundingClientRect" in Text.prototype)
) {
  Object.defineProperty(Text.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  typeof Range !== "undefined" &&
  typeof Range.prototype.getClientRects !== "function"
) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

if (
  typeof Range !== "undefined" &&
  typeof Range.prototype.getBoundingClientRect !== "function"
) {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

if (
  typeof document !== "undefined" &&
  typeof document.elementFromPoint !== "function"
) {
  document.elementFromPoint = function elementFromPointPolyfill() {
    return document.body;
  };
}

if (typeof window !== "undefined" && !window.IntersectionObserver) {
  class IntersectionObserverPolyfill {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver =
    IntersectionObserverPolyfill as unknown as typeof IntersectionObserver;
}
