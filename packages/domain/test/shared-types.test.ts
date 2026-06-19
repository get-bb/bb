import { describe, expect, it } from "vitest";
import {
  promptMentionCommandTriggerSchema,
  promptMentionCommandTriggerValues,
  promptMentionResourceSchema,
} from "../src/shared-types.js";

describe("prompt mention command triggers", () => {
  it("accepts provider-owned command triggers", () => {
    expect(promptMentionCommandTriggerValues).toEqual(["/", "$"]);
    expect(promptMentionCommandTriggerSchema.safeParse("/").success).toBe(true);
    expect(promptMentionCommandTriggerSchema.safeParse("$").success).toBe(true);
  });

  it("accepts dollar command mention resources", () => {
    expect(
      promptMentionResourceSchema.safeParse({
        kind: "command",
        trigger: "$",
        name: "review",
        source: "skill",
        origin: "user",
        label: "review",
        argumentHint: null,
      }).success,
    ).toBe(true);
  });
});
