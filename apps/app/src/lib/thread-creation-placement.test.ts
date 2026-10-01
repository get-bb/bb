import { describe, expect, it } from "vitest";
import { readThreadCreationPlacement } from "./thread-creation-placement";

describe("thread creation placement boundary", () => {
  it.each([
    null,
    {},
    { placement: null },
    { placement: { sectionId: "sec_a", pinned: "true" } },
    { placement: { sectionId: "", pinned: true } },
  ])("rejects invalid placement %j", (state) => {
    expect(readThreadCreationPlacement(state)).toBeNull();
  });
  it("preserves pinning independently from the underlying section", () => {
    expect(
      readThreadCreationPlacement({
        placement: { sectionId: "sec_managers", pinned: true },
      }),
    ).toEqual({ sectionId: "sec_managers", pinned: true });
    expect(
      readThreadCreationPlacement({
        placement: { sectionId: null, pinned: false },
      }),
    ).toEqual({ sectionId: null, pinned: false });
  });
});
