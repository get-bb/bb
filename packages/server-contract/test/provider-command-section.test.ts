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
    expect(providerCommandSection({ source: "plugin", origin: "user" })).toBe(
      "plugin",
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
      "plugin",
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
    const pluginRank = providerCommandSectionRank({
      source: "plugin",
      origin: "user",
    });
    const userRank = providerCommandSectionRank({
      source: "command",
      origin: "user",
    });

    expect(agentCommandRank).toBe(0);
    expect(skillRank).toBe(1);
    expect(pluginRank).toBe(2);
    expect(projectRank).toBe(3);
    expect(userRank).toBe(4);
    expect(agentCommandRank).toBeLessThan(skillRank);
    expect(skillRank).toBeLessThan(pluginRank);
    expect(pluginRank).toBeLessThan(projectRank);
    expect(projectRank).toBeLessThan(userRank);
  });
});
