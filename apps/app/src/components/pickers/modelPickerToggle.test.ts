import { describe, expect, it } from "vitest";
import { resolveModelPickerToggle } from "./modelPickerToggle";

// Stand-ins for `[data-app-composer]` elements. Reference identity is all the
// decision compares, so bare objects cast to Element keep the test DOM-free.
const composerA = {} as Element;
const composerB = {} as Element;

const base = {
  open: false,
  disabled: false,
  isFocusedPane: true,
  targetComposer: composerA,
  pickerComposer: composerA,
} as const;

describe("resolveModelPickerToggle", () => {
  it("opens when the focused pane's cursor sits in this picker's composer", () => {
    expect(resolveModelPickerToggle(base)).toBe("open");
  });

  it("closes an open picker regardless of focus or target", () => {
    expect(
      resolveModelPickerToggle({
        ...base,
        open: true,
        isFocusedPane: false,
        targetComposer: composerB,
        pickerComposer: composerA,
      }),
    ).toBe("close");
  });

  it("ignores the chord entirely while disabled", () => {
    expect(resolveModelPickerToggle({ ...base, disabled: true })).toBe(
      "ignore",
    );
  });

  it("ignores panes that are not focused", () => {
    expect(resolveModelPickerToggle({ ...base, isFocusedPane: false })).toBe(
      "ignore",
    );
  });

  it("ignores a picker whose composer is not the one under the cursor", () => {
    expect(
      resolveModelPickerToggle({ ...base, targetComposer: composerB }),
    ).toBe("ignore");
  });

  it("opens the focused pane's picker when focus is outside every composer", () => {
    // Keyboard pane navigation leaves focus off the text field: the cursor is in
    // no composer, so the focused pane's picker still opens.
    expect(
      resolveModelPickerToggle({ ...base, targetComposer: null }),
    ).toBe("open");
  });

  it("still requires focus when the cursor is outside every composer", () => {
    expect(
      resolveModelPickerToggle({
        ...base,
        targetComposer: null,
        isFocusedPane: false,
      }),
    ).toBe("ignore");
  });
});
