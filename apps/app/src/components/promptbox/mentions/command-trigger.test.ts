import { describe, expect, it } from "vitest";
import {
  commandPillDismissedRangeEnd,
  commandTriggerForProvider,
} from "./command-trigger";

describe("commandTriggerForProvider", () => {
  it("maps claude-code to the slash trigger", () => {
    expect(commandTriggerForProvider("claude-code")).toBe("/");
  });

  it("maps codex to the slash trigger", () => {
    expect(commandTriggerForProvider("codex")).toBe("/");
  });

  it("does not expose the legacy dollar trigger for codex", () => {
    expect(commandTriggerForProvider("codex")).not.toBe("$");
  });

  it("returns null for providers with no command surface", () => {
    expect(commandTriggerForProvider("pi")).toBeNull();
  });

  it("returns null for unknown provider ids", () => {
    expect(commandTriggerForProvider("totally-unknown")).toBeNull();
  });
});

describe("commandPillDismissedRangeEnd", () => {
  it("counts the command pill as a one-position editor atom", () => {
    expect(
      commandPillDismissedRangeEnd({
        triggerPosition: 5,
        trailingText: " ",
      }),
    ).toBe(7);
  });

  it("does not include serialized command name length", () => {
    expect(
      commandPillDismissedRangeEnd({
        triggerPosition: 5,
        trailingText: "",
      }),
    ).toBe(6);
  });
});
