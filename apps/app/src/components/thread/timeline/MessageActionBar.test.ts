import { describe, expect, it } from "vitest";
import { computeMessageActionRowLayout } from "./MessageActionBar";

describe("computeMessageActionRowLayout", () => {
  const metrics = { actionWidth: 20 };

  it("renders every candidate inline before the slot is measured", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 5,
        availableWidth: undefined,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 5, overflowCount: 0 });
  });

  it("reserves space for the always-present menu trigger", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 100,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 3, overflowCount: 0 });
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 99,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 2, overflowCount: 1 });
  });

  it("moves candidates into overflow from the end", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 72,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 2, overflowCount: 1 });
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 71,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 1, overflowCount: 2 });
  });

  it("puts every candidate in the menu when none fit beside the trigger", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 30,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 3 });
  });

  it("returns an empty layout for zero candidates", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 0,
        availableWidth: 400,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 0 });
  });
});
