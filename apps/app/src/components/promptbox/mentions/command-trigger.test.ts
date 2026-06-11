import { describe, expect, it } from "vitest";
import { commandTriggerForProvider } from "./command-trigger";

describe("commandTriggerForProvider", () => {
  it("maps claude-code to the slash trigger", () => {
    expect(commandTriggerForProvider("claude-code")).toBe("/");
  });

  it("maps codex to the dollar trigger", () => {
    expect(commandTriggerForProvider("codex")).toBe("$");
  });

  it("returns null for providers with no command surface", () => {
    expect(commandTriggerForProvider("pi")).toBeNull();
  });

  it("returns null for unknown provider ids", () => {
    expect(commandTriggerForProvider("totally-unknown")).toBeNull();
  });
});
