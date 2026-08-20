/// <reference types="vitest/jsdom" />

// `Icon` renders extended-registry glyphs as an empty placeholder until
// `@bb/shared-ui/icon-extended` has evaluated; in the app every route chunk
// imports it statically. Load it once here so component tests see the same
// synchronous icons a mounted route does, instead of a placeholder that fills
// in outside `act`. `components/ui/icon.test.tsx` resets modules to cover the
// cold path.
import "@bb/shared-ui/icon-extended";

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

// `@pierre/diffs` (CodeView) reads `navigator.userAgent` at module load for
// feature detection. Vitest's default `node` environment exposes no
// `navigator`, so any node-env test that transitively imports the diff renderer
// (e.g. via the `components/thread/timeline` barrel) crashes at import. Provide a
// minimal stub where one is absent; jsdom tests already have a real `navigator`.
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

// @silk-hq/components evaluates CSS.supports at module load for feature
// detection. jsdom does not provide CSS.supports.
if (
  typeof window !== "undefined" &&
  (typeof globalThis.CSS === "undefined" ||
    typeof globalThis.CSS.supports !== "function")
) {
  globalThis.CSS = {
    supports: Object.assign(() => false, { supports: () => false }),
    escape: (value: string) => value,
  } as unknown as typeof CSS;
}

// Silk reads visualViewport during sheet mount. jsdom omits it.
if (typeof window !== "undefined" && window.visualViewport == null) {
  const visualViewport = {
    width: window.innerWidth || 1024,
    height: window.innerHeight || 768,
    offsetLeft: 0,
    offsetTop: 0,
    pageLeft: 0,
    pageTop: 0,
    scale: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onresize: null,
    onscroll: null,
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: visualViewport,
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

// Silk's scroll trap calls element.scrollTo during mount.
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollTo !== "function"
) {
  Element.prototype.scrollTo = function scrollToPolyfill() {};
}
if (
  typeof Element !== "undefined" &&
  typeof Element.prototype.scrollBy !== "function"
) {
  Element.prototype.scrollBy = function scrollByPolyfill() {};
}

if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "getClientRects", {
    configurable: true,
    value: function getClientRectsPolyfill(this: Element) {
      const rect = this.getBoundingClientRect();
      return {
        length: 1,
        0: rect,
        item: (index: number) => (index === 0 ? rect : null),
        [Symbol.iterator]: function* () {
          yield rect;
        },
      } as DOMRectList;
    },
  });
}

// Silk spring/travel math allocates from measured geometry. jsdom reports
// zero-size rects by default, which can throw "Invalid array length". Only
// invent non-zero boxes for Silk sheet surfaces (or explicit test attrs) so
// unrelated layout tests keep native jsdom geometry/viewport behavior.
if (typeof Element !== "undefined") {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function getBoundingClientRectPolyfill(this: Element) {
      const el = this as HTMLElement;
      const widthAttr = Number(el.getAttribute?.("data-test-width") ?? NaN);
      const heightAttr = Number(el.getAttribute?.("data-test-height") ?? NaN);
      const explicitWidth =
        Number.isFinite(widthAttr) && widthAttr > 0 ? widthAttr : 0;
      const explicitHeight =
        Number.isFinite(heightAttr) && heightAttr > 0 ? heightAttr : 0;
      if (explicitWidth > 0 || explicitHeight > 0) {
        return new DOMRect(
          0,
          0,
          explicitWidth || el.clientWidth || el.scrollWidth || 390,
          explicitHeight || el.clientHeight || el.scrollHeight || 844,
        );
      }

      const isSilkSurface =
        typeof el.closest === "function" &&
        el.closest(
          "[data-bb-sheet-root], [data-bb-sheet-view], [data-bb-sheet-content], [data-bb-sheet-backdrop], [data-bb-sheet-retained], [data-bb-sidebar-sheet-panel]",
        ) !== null;

      if (isSilkSurface) {
        const width = el.clientWidth || el.scrollWidth || 390;
        const height = el.clientHeight || el.scrollHeight || 844;
        return new DOMRect(0, 0, width, height);
      }

      if (typeof originalGetBoundingClientRect === "function") {
        return originalGetBoundingClientRect.call(this);
      }
      return new DOMRect(0, 0, 0, 0);
    },
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
