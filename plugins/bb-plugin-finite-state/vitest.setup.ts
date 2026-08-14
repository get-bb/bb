/// <reference types="vitest/jsdom" />

import { configure } from "@testing-library/react";

if (typeof window !== "undefined" && typeof jsdom !== "undefined") {
  // Node defines global storage accessors. Vitest keeps existing globals when
  // it overlays jsdom, then aliases `window` to `globalThis`, so restore the
  // real jsdom storage objects explicitly.
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: jsdom.window.localStorage,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: jsdom.window.sessionStorage,
  });
}

// Match loaded CI runners: the default 1s async-utility timeout flakes while
// the suite-level Vitest timeout still bounds real hangs.
configure({ asyncUtilTimeout: 10_000 });
