import { describe, expect, it } from "vitest";
import {
  adjacentReasoningValue,
  nextCycleValue,
  previousCycleValue,
} from "./modelPickerCycle";

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

describe("previousCycleValue", () => {
  it("moves backward and wraps from the first option", () => {
    expect(previousCycleValue(options, "b")).toBe("a");
    expect(previousCycleValue(options, "a")).toBe("c");
  });

  it("starts at the last option when the value is absent", () => {
    expect(previousCycleValue(options, "gone")).toBe("c");
  });

  it("returns null when there is nowhere to move", () => {
    expect(previousCycleValue([], "a")).toBeNull();
    expect(previousCycleValue([{ value: "a", label: "A" }], "a")).toBeNull();
  });
});

describe("adjacentReasoningValue", () => {
  it("moves in the requested direction without wrapping", () => {
    expect(adjacentReasoningValue(options, "b", "increase")).toBe("c");
    expect(adjacentReasoningValue(options, "b", "decrease")).toBe("a");
    expect(adjacentReasoningValue(options, "c", "increase")).toBeNull();
    expect(adjacentReasoningValue(options, "a", "decrease")).toBeNull();
  });

  it("starts at the directional edge when the value is absent", () => {
    expect(adjacentReasoningValue(options, "gone", "increase")).toBe("a");
    expect(adjacentReasoningValue(options, "gone", "decrease")).toBe("c");
  });

  it("requires two choices", () => {
    expect(adjacentReasoningValue([options[0]!], "a", "increase")).toBeNull();
  });
});
