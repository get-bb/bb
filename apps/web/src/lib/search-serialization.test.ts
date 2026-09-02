import { describe, expect, it } from "vitest";

import { stringifySiteSearch } from "./search-serialization.js";

describe("stringifySiteSearch", () => {
  it("uses repeatable category parameters and omits an empty array", () => {
    expect(
      stringifySiteSearch({
        category: ["thread-content", "code-and-reviews"],
        sort: "recently-added",
      }),
    ).toBe(
      "?sort=recently-added&category=thread-content&category=code-and-reviews",
    );
    expect(stringifySiteSearch({ category: [] })).toBe("");
  });
});
