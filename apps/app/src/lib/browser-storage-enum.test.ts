import { createMemoryStorage } from "@bb/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalStorageEnumStorage,
  createNullableLocalStorageEnumStorage,
} from "./browser-storage";

type DisplayMode = "unified" | "split";
type OverflowMode = "wrap" | "scroll";

function isDisplayMode(value: string): value is DisplayMode {
  return value === "unified" || value === "split";
}

function isOverflowMode(value: string): value is OverflowMode {
  return value === "wrap" || value === "scroll";
}

let localStorage: Storage;

beforeEach(() => {
  localStorage = createMemoryStorage();
  vi.stubGlobal("window", { localStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createNullableLocalStorageEnumStorage", () => {
  it("restores a stored value and clears it when set to null", () => {
    const storage = createNullableLocalStorageEnumStorage(isDisplayMode);

    storage.setItem("mode", "split");
    expect(storage.getItem("mode", null)).toBe("split");

    storage.setItem("mode", null);
    expect(localStorage.getItem("mode")).toBeNull();
  });

  it("ignores an unrecognized stored value", () => {
    localStorage.setItem("mode", "sideways");

    expect(
      createNullableLocalStorageEnumStorage(isDisplayMode).getItem(
        "mode",
        null,
      ),
    ).toBeNull();
  });
});

describe("createLocalStorageEnumStorage", () => {
  it("restores a stored value", () => {
    const storage = createLocalStorageEnumStorage(isOverflowMode);

    storage.setItem("overflow", "wrap");

    expect(localStorage.getItem("overflow")).toBe("wrap");
    expect(storage.getItem("overflow", "scroll")).toBe("wrap");
  });

  it("falls back to the initial value for an unrecognized stored value", () => {
    localStorage.setItem("overflow", "fold");

    expect(
      createLocalStorageEnumStorage(isOverflowMode).getItem(
        "overflow",
        "scroll",
      ),
    ).toBe("scroll");
  });
});
