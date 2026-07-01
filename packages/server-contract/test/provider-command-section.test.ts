import { describe, expect, it } from "vitest";
import {
  PROVIDER_COMMAND_SECTIONS,
  providerCommandSection,
  providerCommandSectionRank,
} from "../src/index.js";

describe("providerCommandSection", () => {
  it("maps source + origin to the menu's visual sections", () => {
    expect(
      providerCommandSection({ source: "skill", origin: "project" }),
    ).toBe("skill");
    expect(providerCommandSection({ source: "skill", origin: "user" })).toBe(
      "skill",
    );
    expect(
      providerCommandSection({ source: "command", origin: "builtin" }),
    ).toBe("agent-command");
    expect(
      providerCommandSection({ source: "command", origin: "project" }),
    ).toBe("project-command");
    expect(
      providerCommandSection({ source: "command", origin: "user" }),
    ).toBe("user-command");
  });
});

describe("providerCommandSectionRank", () => {
  it("ranks sections in the menu's top-to-bottom visual order", () => {
    expect(PROVIDER_COMMAND_SECTIONS).toEqual([
      "agent-command",
      "skill",
      "project-command",
      "user-command",
    ]);

    const agentCommandRank = providerCommandSectionRank({
      source: "command",
      origin: "builtin",
    });
    const skillRank = providerCommandSectionRank({
      source: "skill",
      origin: "user",
    });
    const projectRank = providerCommandSectionRank({
      source: "command",
      origin: "project",
    });
    const userRank = providerCommandSectionRank({
      source: "command",
      origin: "user",
    });

    expect(agentCommandRank).toBe(0);
    expect(skillRank).toBe(1);
    expect(projectRank).toBe(2);
    expect(userRank).toBe(3);
    expect(agentCommandRank).toBeLessThan(skillRank);
    expect(skillRank).toBeLessThan(projectRank);
    expect(projectRank).toBeLessThan(userRank);
  });
});
