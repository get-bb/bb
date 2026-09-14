// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabScopedStorage } from "./browser-storage";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function selectionStorage() {
  return createTabScopedStorage<string>(
    {
      parse: (value, initialValue) => value ?? initialValue,
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  );
}

describe("tab-scoped selection storage", () => {
  it("pins an empty default without overwriting the shared seed on subsequent reads", () => {
    const storage = selectionStorage();
    expect(storage.getItem("selection", "")).toBe("");
    window.localStorage.setItem("selection", "another-tab");
    expect(selectionStorage().getItem("selection", "fallback")).toBe("");
    expect(window.localStorage.getItem("selection")).toBe("another-tab");
  });

  it("keeps session persistence when local storage writes fail", () => {
    const storage = selectionStorage();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (this: Storage, key, value) {
        if (this === window.localStorage)
          throw new DOMException("Full", "QuotaExceededError");
        original.call(this, key, value);
      },
    );
    expect(() => storage.setItem("selection", "mine")).not.toThrow();
    expect(selectionStorage().getItem("selection", "fallback")).toBe("mine");
  });

  it("can read and update shared defaults when session storage is unavailable", () => {
    window.localStorage.setItem("selection", "seed");
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const storage = selectionStorage();
    expect(storage.getItem("selection", "fallback")).toBe("seed");
    expect(() => storage.setItem("selection", "mine")).not.toThrow();
    expect(window.localStorage.getItem("selection")).toBe("mine");
    expect(() => storage.removeItem("selection")).not.toThrow();
    expect(window.localStorage.getItem("selection")).toBeNull();
  });
});
