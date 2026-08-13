import { describe, expect, it } from "vitest";
import type { ReasoningLevel } from "@bb/domain";
import {
  cycleReasoningValue,
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

describe("cycleReasoningValue", () => {
  const unorderedOptions = [
    { value: "max", label: "Max" },
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ] satisfies readonly { value: ReasoningLevel; label: string }[];

  it("cycles in canonical rank rather than provider response order", () => {
    expect(cycleReasoningValue(unorderedOptions, "low", "forward")).toBe(
      "high",
    );
    expect(cycleReasoningValue(unorderedOptions, "high", "forward")).toBe(
      "max",
    );
    expect(cycleReasoningValue(unorderedOptions, "high", "backward")).toBe(
      "low",
    );
  });

  it("wraps at both canonical edges", () => {
    expect(cycleReasoningValue(unorderedOptions, "max", "forward")).toBe("low");
    expect(cycleReasoningValue(unorderedOptions, "low", "backward")).toBe(
      "max",
    );
  });

  it("keeps canonical direction when the current effort is unsupported", () => {
    expect(cycleReasoningValue(unorderedOptions, "medium", "forward")).toBe(
      "high",
    );
    expect(cycleReasoningValue(unorderedOptions, "medium", "backward")).toBe(
      "low",
    );
  });

  it("returns null when there is nowhere to move", () => {
    expect(
      cycleReasoningValue(
        [{ value: "high", label: "High" }],
        "high",
        "forward",
      ),
    ).toBeNull();
    expect(cycleReasoningValue([], "medium", "forward")).toBeNull();
  });
});
