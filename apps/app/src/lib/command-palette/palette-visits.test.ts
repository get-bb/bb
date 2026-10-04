// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  PALETTE_VISITS_LIMIT,
  readPaletteVisits,
  recordPaletteVisit,
} from "./palette-visits";

const KEY = "bb.palette.visits";

function stored(): unknown {
  return JSON.parse(window.localStorage.getItem(KEY) ?? "null");
}

afterEach(() => {
  window.localStorage.clear();
});

describe("palette visits", () => {
  it("keeps one entry per place, newest first", () => {
    recordPaletteVisit("thread", "a", 1);
    recordPaletteVisit("thread", "b", 2);
    recordPaletteVisit("thread", "a", 3);
    recordPaletteVisit("page", "a", 4);
    expect(readPaletteVisits()).toEqual([
      { kind: "page", id: "a", visitedAt: 4 },
      { kind: "thread", id: "a", visitedAt: 3 },
      { kind: "thread", id: "b", visitedAt: 2 },
    ]);
  });

  it("caps the log by evicting the oldest entries", () => {
    for (let index = 0; index < PALETTE_VISITS_LIMIT + 5; index++) {
      recordPaletteVisit("thread", `thread-${index}`, index);
    }
    const visits = readPaletteVisits();
    expect(visits).toHaveLength(PALETTE_VISITS_LIMIT);
    expect(visits[0]?.id).toBe(`thread-${PALETTE_VISITS_LIMIT + 4}`);
    expect(visits.at(-1)?.id).toBe("thread-5");
  });

  it("skips unknown kinds and bad entries without dropping the rest", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: "future-kind", id: "x", visitedAt: 9 },
        { kind: "thread", id: "", visitedAt: 8 },
        { kind: "thread", id: "bad-time", visitedAt: "now" },
        "junk",
        null,
        { kind: "thread", id: "kept", visitedAt: 5 },
        { kind: "setting", id: "settings:keyboard", visitedAt: 4 },
      ]),
    );
    expect(readPaletteVisits()).toEqual([
      { kind: "thread", id: "kept", visitedAt: 5 },
      { kind: "setting", id: "settings:keyboard", visitedAt: 4 },
    ]);
  });

  it("preserves entries it cannot read when recording a visit", () => {
    const future = { kind: "future-kind", id: "x", visitedAt: 9 };
    window.localStorage.setItem(
      KEY,
      JSON.stringify([future, { kind: "thread", id: "deleted", visitedAt: 5 }]),
    );
    recordPaletteVisit("thread", "new", 10);
    expect(stored()).toEqual([
      { kind: "thread", id: "new", visitedAt: 10 },
      future,
      { kind: "thread", id: "deleted", visitedAt: 5 },
    ]);
  });

  it.each(["{not json", JSON.stringify({ kind: "thread" }), "42"])(
    "treats an unreadable stored value as empty: %s",
    (value) => {
      window.localStorage.setItem(KEY, value);
      expect(readPaletteVisits()).toEqual([]);
      recordPaletteVisit("thread", "a", 1);
      expect(readPaletteVisits()).toEqual([
        { kind: "thread", id: "a", visitedAt: 1 },
      ]);
    },
  );

  it("reads storage on every call so other windows' visits are kept", () => {
    recordPaletteVisit("thread", "mine", 1);
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { kind: "thread", id: "other-window", visitedAt: 2 },
        { kind: "thread", id: "mine", visitedAt: 1 },
      ]),
    );
    recordPaletteVisit("thread", "mine-again", 3);
    expect(readPaletteVisits().map((visit) => visit.id)).toEqual([
      "mine-again",
      "other-window",
      "mine",
    ]);
  });
});
