// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isImeComposing, isNonImeKey } from "./ime-keyboard";

afterEach(cleanup);

describe("isNonImeKey", () => {
  it.each([
    [
      "rejects a Chromium composition keystroke",
      { key: "Enter", isComposing: true },
      false,
    ],
    [
      "rejects the Safari keystroke right after compositionend",
      { key: "Escape", keyCode: 229 },
      false,
    ],
    ["accepts a plain keystroke", { key: "Enter", keyCode: 13 }, true],
  ])("%s", (_name, init, expected) => {
    expect(isNonImeKey(new KeyboardEvent("keydown", init), init.key)).toBe(
      expected,
    );
  });

  it("does not match a different key", () => {
    expect(
      isNonImeKey(new KeyboardEvent("keydown", { key: "Tab" }), "Enter"),
    ).toBe(false);
  });

  it("reads composition state through React keyboard events", () => {
    const seen = vi.fn();
    render(
      <input
        aria-label="field"
        onKeyDown={(event) =>
          seen(isNonImeKey(event, "Enter"), isImeComposing(event))
        }
      />,
    );
    const field = screen.getByRole("textbox", { name: "field" });

    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Enter", keyCode: 13 });

    expect(seen.mock.calls).toEqual([
      [false, true],
      [true, false],
    ]);
  });
});
