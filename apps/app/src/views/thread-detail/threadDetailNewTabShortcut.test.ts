import { describe, expect, it } from "vitest";
import { isThreadNewTabKeyboardShortcut } from "./threadDetailNewTabShortcut";

function buildEvent(
  overrides: Partial<Parameters<typeof isThreadNewTabKeyboardShortcut>[0]> = {},
): Parameters<typeof isThreadNewTabKeyboardShortcut>[0] {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "t",
    metaKey: true,
    shiftKey: false,
    ...overrides,
  };
}

describe("isThreadNewTabKeyboardShortcut", () => {
  it("matches command-t and ctrl-t", () => {
    expect(isThreadNewTabKeyboardShortcut(buildEvent())).toBe(true);
    expect(
      isThreadNewTabKeyboardShortcut(
        buildEvent({ ctrlKey: true, metaKey: false }),
      ),
    ).toBe(true);
  });

  it("ignores modified or already-handled key events", () => {
    expect(
      isThreadNewTabKeyboardShortcut(buildEvent({ altKey: true })),
    ).toBe(false);
    expect(
      isThreadNewTabKeyboardShortcut(buildEvent({ shiftKey: true })),
    ).toBe(false);
    expect(
      isThreadNewTabKeyboardShortcut(buildEvent({ defaultPrevented: true })),
    ).toBe(false);
  });

  it("requires the t key and a platform modifier", () => {
    expect(isThreadNewTabKeyboardShortcut(buildEvent({ key: "n" }))).toBe(
      false,
    );
    expect(
      isThreadNewTabKeyboardShortcut(
        buildEvent({ ctrlKey: false, metaKey: false }),
      ),
    ).toBe(false);
  });
});
