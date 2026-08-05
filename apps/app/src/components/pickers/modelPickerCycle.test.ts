import { describe, expect, it } from "vitest";
import {
  nextCycleValue,
  shouldModelPickerCycle,
  type ModelPickerCycleScope,
} from "./modelPickerCycle";

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

function scope(overrides: Partial<ModelPickerCycleScope>) {
  return {
    disabled: false,
    isFocusedPane: true,
    isSplitPane: false,
    isPrimaryComposer: true,
    caretInThisComposer: true,
    caretInOtherComposerOfPane: false,
    ...overrides,
  };
}

describe("nextCycleValue", () => {
  it("wraps from the last option to the first", () => {
    expect(nextCycleValue(options, "b")).toBe("c");
    expect(nextCycleValue(options, "c")).toBe("a");
  });

  it("starts at the first option when the value is absent", () => {
    expect(nextCycleValue(options, "gone")).toBe("a");
  });

  it("returns null when there is nowhere to move", () => {
    expect(nextCycleValue([], "a")).toBeNull();
    expect(nextCycleValue([{ value: "a", label: "A" }], "a")).toBeNull();
  });
});

describe("shouldModelPickerCycle", () => {
  it("cycles the composer that holds the caret", () => {
    expect(shouldModelPickerCycle(scope({}))).toBe(true);
  });

  it("ignores disabled pickers and unfocused panes", () => {
    expect(shouldModelPickerCycle(scope({ disabled: true }))).toBe(false);
    expect(shouldModelPickerCycle(scope({ isFocusedPane: false }))).toBe(false);
  });

  it("defers to a sibling composer of the same pane", () => {
    expect(
      shouldModelPickerCycle(
        scope({
          caretInThisComposer: false,
          caretInOtherComposerOfPane: true,
        }),
      ),
    ).toBe(false);
  });

  it("falls back to the primary composer only inside a split", () => {
    expect(shouldModelPickerCycle(scope({ caretInThisComposer: false }))).toBe(
      false,
    );
    expect(
      shouldModelPickerCycle(
        scope({ caretInThisComposer: false, isSplitPane: true }),
      ),
    ).toBe(true);
    expect(
      shouldModelPickerCycle(
        scope({
          caretInThisComposer: false,
          isSplitPane: true,
          isPrimaryComposer: false,
        }),
      ),
    ).toBe(false);
  });
});
