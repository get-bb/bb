import { describe, expect, it } from "vitest";
import { selectTerminalTail } from "./terminal-output";

describe("selectTerminalTail", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index}`);

  it("keeps the tail when collapsed", () => {
    const tail = selectTerminalTail(lines, 10, false);
    expect(tail.hiddenLines).toBe(30);
    expect(tail.visible).toEqual(lines.slice(30));
  });

  it("shows everything when expanded, uncapped, or within slack", () => {
    expect(selectTerminalTail(lines, 10, true)).toEqual({
      visible: lines,
      hiddenLines: 0,
    });
    expect(
      selectTerminalTail(lines, Number.POSITIVE_INFINITY, false).hiddenLines,
    ).toBe(0);
    expect(selectTerminalTail(lines.slice(0, 15), 10, false).hiddenLines).toBe(
      0,
    );
  });
});
