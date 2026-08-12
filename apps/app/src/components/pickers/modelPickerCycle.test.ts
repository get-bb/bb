import { describe, expect, it } from "vitest";
import type { ReasoningLevel } from "@bb/domain";
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
  const unorderedOptions = [
    { value: "max", label: "Max" },
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ] satisfies readonly { value: ReasoningLevel; label: string }[];

  it("uses canonical rank rather than provider response order", () => {
    expect(adjacentReasoningValue(unorderedOptions, "low", "increase")).toBe(
      "high",
    );
    expect(adjacentReasoningValue(unorderedOptions, "high", "increase")).toBe(
      "max",
    );
    expect(adjacentReasoningValue(unorderedOptions, "high", "decrease")).toBe(
      "low",
    );
  });

  it("clamps instead of wrapping at either canonical edge", () => {
    expect(adjacentReasoningValue(unorderedOptions, "max", "increase")).toBeNull();
    expect(adjacentReasoningValue(unorderedOptions, "low", "decrease")).toBeNull();
  });

  it("keeps direction when the current effort is unsupported", () => {
    expect(adjacentReasoningValue(unorderedOptions, "medium", "increase")).toBe(
      "high",
    );
    expect(adjacentReasoningValue(unorderedOptions, "medium", "decrease")).toBe(
      "low",
    );
  });

  it("requires two choices", () => {
    expect(
      adjacentReasoningValue(
        [{ value: "high", label: "High" }],
        "medium",
        "increase",
      ),
    ).toBeNull();
  });
});
