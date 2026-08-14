// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("Vitest Web Storage setup", () => {
  it("restores jsdom's real local and session storage objects", () => {
    expect(localStorage).toBe(window.localStorage);
    expect(sessionStorage).toBe(window.sessionStorage);
    expect(localStorage.constructor.name).toBe("Storage");
    expect(sessionStorage.constructor.name).toBe("Storage");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    localStorage.setItem("first", "one");
    localStorage.setItem("second", "two");
    localStorage.setItem("first", "updated");

    expect(localStorage.length).toBe(2);
    expect(localStorage.key(0)).toBe("first");
    expect(localStorage.key(1)).toBe("second");
    expect(localStorage.key(2)).toBeNull();
    expect(localStorage.getItem("first")).toBe("updated");
    expect(localStorage.getItem("missing")).toBeNull();

    localStorage.removeItem("first");
    expect(localStorage.getItem("first")).toBeNull();

    localStorage.clear();
    expect(localStorage.length).toBe(0);

    sessionStorage.setItem("device-panel", "session-value");
    expect(sessionStorage.getItem("device-panel")).toBe("session-value");
  });
});
