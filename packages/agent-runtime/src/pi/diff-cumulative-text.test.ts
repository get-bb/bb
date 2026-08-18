import { describe, expect, it } from "vitest";
import { diffCumulativeText } from "./diff-cumulative-text.js";

describe("diffCumulativeText", () => {
  it("emits the first chunk when no prior snapshot exists", () => {
    expect(
      diffCumulativeText({
        nextText: "FIRST\n",
      }),
    ).toEqual({
      delta: "FIRST\n",
      nextText: "FIRST\n",
      reset: false,
    });
  });

  it("emits only the suffix for cumulative updates", () => {
    expect(
      diffCumulativeText({
        previousText: "FIRST\n",
        nextText: "FIRST\nSECOND\n",
      }),
    ).toEqual({
      delta: "SECOND\n",
      nextText: "FIRST\nSECOND\n",
      reset: false,
    });
  });

  it("falls back to the full text after a reset", () => {
    expect(
      diffCumulativeText({
        previousText: "FIRST\nSECOND\n",
        nextText: "THIRD\n",
      }),
    ).toEqual({
      delta: "THIRD\n",
      nextText: "THIRD\n",
      reset: true,
    });
  });
});
