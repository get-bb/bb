import { configure } from "@testing-library/react";

// Match slow CI runners: the default 1s async-utility timeout flakes there
// while the suite-level vitest testTimeout still bounds real hangs.
configure({ asyncUtilTimeout: 8_000 });

// Radix Select scrolls the chosen item into view when its portal opens.
// jsdom does not implement this browser API.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

// The shared-ui Dialog resolves a responsive layout via matchMedia, which
// jsdom does not implement. Default to the non-compact (desktop) branch.
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}
