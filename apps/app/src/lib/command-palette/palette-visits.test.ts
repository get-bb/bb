// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPaletteThreadVisits,
  recordPaletteThreadVisit,
} from "./palette-visits";

const KEY = "bb.palette.visits";
const LIMIT = 100;

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("palette thread visits", () => {
  it("moves a revisited thread to the front without duplicating it", () => {
    recordPaletteThreadVisit("a");
    recordPaletteThreadVisit("b");
    recordPaletteThreadVisit("a");
    expect(readPaletteThreadVisits()).toEqual(["a", "b"]);
  });

  it("caps the log by evicting the oldest entries", () => {
    for (let index = 0; index < LIMIT + 5; index++) {
      recordPaletteThreadVisit(`thread-${index}`);
    }
    const visits = readPaletteThreadVisits();
    expect(visits).toHaveLength(LIMIT);
    expect(visits[0]).toBe(`thread-${LIMIT + 4}`);
    expect(visits.at(-1)).toBe("thread-5");
  });

  it.each(["{not json", JSON.stringify({ id: "a" }), "42"])(
    "treats an unreadable stored value as empty: %s",
    (value) => {
      window.localStorage.setItem(KEY, value);
      expect(readPaletteThreadVisits()).toEqual([]);
    },
  );

  it("ignores non-string and duplicate entries", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(["a", null, { id: "x" }, 7, "b", "a"]),
    );
    expect(readPaletteThreadVisits()).toEqual(["a", "b"]);
  });

  it("swallows storage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => recordPaletteThreadVisit("a")).not.toThrow();
  });
});
