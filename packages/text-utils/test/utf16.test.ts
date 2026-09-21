import { describe, expect, it } from "vitest";
import { sliceUtf16HeadAndTail } from "../src/index.js";

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
});
