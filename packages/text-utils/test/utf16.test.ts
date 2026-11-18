import { describe, expect, it } from "vitest";
import {
  sliceUtf16Head,
  sliceUtf16HeadAndTail,
  sliceUtf16Tail,
  toWellFormedUtf16,
} from "../src/index.js";

describe("sliceUtf16HeadAndTail", () => {
  it("does not split surrogate pairs at either boundary", () => {
    expect(sliceUtf16HeadAndTail("a𠮷bc𠮷d", 2, 2)).toEqual({
      head: "a",
      tail: "d",
    });
    expect(sliceUtf16HeadAndTail("abcdef", 2, 2)).toEqual({
      head: "ab",
      tail: "ef",
    });
  });

  it("slices a safe head", () => {
    expect(sliceUtf16Head("a𠮷bc", 2)).toBe("a");
    expect(sliceUtf16Head("abcdef", 2)).toBe("ab");
    expect(sliceUtf16Head("abcdef", -1)).toBe("");
  });

  it("slices a safe tail", () => {
    expect(sliceUtf16Tail("ab𠮷d", 2)).toBe("d");
    expect(sliceUtf16Tail("abcdef", 2)).toBe("ef");
    expect(sliceUtf16Tail("abcdef", -1)).toBe("");
  });
});

describe("toWellFormedUtf16", () => {
  it("replaces lone surrogates and keeps pairs", () => {
    const pair = "\u{1F600}";
    expect(toWellFormedUtf16(`a${pair.slice(0, 1)}b`)).toBe("a\uFFFDb");
    expect(toWellFormedUtf16(`a${pair.slice(1)}`)).toBe("a\uFFFD");
    expect(toWellFormedUtf16(`${pair}${pair.slice(1)}${pair}`)).toBe(
      `${pair}\uFFFD${pair}`,
    );
    expect(toWellFormedUtf16(`ok ${pair}`)).toBe(`ok ${pair}`);
  });
});
