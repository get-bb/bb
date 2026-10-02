import { describe, expect, it } from "vitest";
import { automationDueBodyOffset } from "../src/timeline/automation-due-message.js";

describe("automationDueBodyOffset", () => {
  it("returns the prompt offset after the automation marker", () => {
    const text =
      "[bb automation due:auto_zto0dtbcxme]\n\nWeekday unread digest.";
    const offset = automationDueBodyOffset(text);
    expect(offset).not.toBeNull();
    expect(text.slice(offset ?? 0)).toBe("Weekday unread digest.");
  });

  it("ignores text that only mentions the marker later on", () => {
    expect(
      automationDueBodyOffset("See [bb automation due:auto_1] for details"),
    ).toBeNull();
  });

  it("ignores other bb prefixes and malformed markers", () => {
    expect(automationDueBodyOffset("[bb system]\n\nhello")).toBeNull();
    expect(automationDueBodyOffset("[bb automation due:]\n\nhello")).toBeNull();
    expect(automationDueBodyOffset("[bb automation due:auto_1")).toBeNull();
  });
});
