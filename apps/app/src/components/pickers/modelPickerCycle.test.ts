import { describe, expect, it } from "vitest";
import { nextCycleValue } from "./modelPickerCycle";

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

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
