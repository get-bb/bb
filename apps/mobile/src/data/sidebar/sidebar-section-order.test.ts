import { describe, expect, it } from "vitest";
import { mergeHiddenSectionOrder } from "./sidebar-section-order";

describe("mergeHiddenSectionOrder", () => {
  it("applies the visible reorder while hidden sections keep their index", () => {
    expect(
      mergeHiddenSectionOrder(
        ["project:a", "pinned", "project:b", "threads"],
        ["threads", "project:b", "project:a"],
      ),
    ).toEqual(["threads", "pinned", "project:b", "project:a"]);
  });

  it("is the identity when nothing is hidden", () => {
    expect(
      mergeHiddenSectionOrder(
        ["pinned", "project:a", "threads"],
        ["project:a", "threads", "pinned"],
      ),
    ).toEqual(["project:a", "threads", "pinned"]);
  });
});
