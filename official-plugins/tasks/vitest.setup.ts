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
