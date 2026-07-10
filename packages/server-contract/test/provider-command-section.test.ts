import { describe, expect, it } from "vitest";
import { providerCommandSection } from "../src/index.js";

describe("providerCommandSection", () => {
  it("maps source + origin to the menu's visual sections", () => {
    expect(providerCommandSection({ source: "skill", origin: "project" })).toBe(
      "skill",
    );
    expect(providerCommandSection({ source: "skill", origin: "user" })).toBe(
      "skill",
    );
    expect(
      providerCommandSection({ source: "command", origin: "builtin" }),
    ).toBe("agent-command");
    expect(
      providerCommandSection({ source: "command", origin: "project" }),
    ).toBe("project-command");
    expect(providerCommandSection({ source: "command", origin: "user" })).toBe(
      "user-command",
    );
  });
});
