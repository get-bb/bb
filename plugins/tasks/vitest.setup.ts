import { configure } from "@testing-library/react";
import { beforeEach } from "vitest";

configure({ asyncUtilTimeout: 8_000 });

const elementConstructor = globalThis.Element;
if (
  elementConstructor !== undefined &&
  !elementConstructor.prototype.scrollIntoView
) {
  Object.defineProperty(elementConstructor.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
}

const browserWindow = globalThis.window;
if (browserWindow !== undefined && !browserWindow.matchMedia) {
  Object.defineProperty(browserWindow, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

beforeEach(() => {
  if (browserWindow !== undefined) browserWindow.localStorage.clear();
});
