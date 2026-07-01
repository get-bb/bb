import { describe, expect, it } from "vitest";
import { promptCommandIconName } from "./prompt-mention-display";

describe("promptCommandIconName", () => {
  it("uses dedicated icons for provider prompt action commands", () => {
    expect(promptCommandIconName({ name: "plan", source: "command" })).toBe(
      "ListTodo",
    );
    expect(promptCommandIconName({ name: "goal", source: "command" })).toBe(
      "Target",
    );
    expect(promptCommandIconName({ name: "loop", source: "command" })).toBe(
      "Repeat",
    );
  });

  it("keeps skill and generic command icons unchanged", () => {
    expect(promptCommandIconName({ name: "review", source: "skill" })).toBe(
      "Zap",
    );
    expect(promptCommandIconName({ name: "review", source: "command" })).toBe(
      "Terminal",
    );
  });
});
