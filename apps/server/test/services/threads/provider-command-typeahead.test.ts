import type { HostProviderCommand } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { buildCommandListResponse } from "../../../src/services/threads/provider-command-typeahead.js";

function skill(
  name: string,
  overrides: Partial<HostProviderCommand> = {},
): HostProviderCommand {
  return {
    name,
    source: "skill",
    origin: overrides.origin ?? "user",
    description: overrides.description ?? null,
    argumentHint: overrides.argumentHint ?? null,
  };
}

describe("buildCommandListResponse", () => {
  it("includes the built-in compact command", () => {
    const response = buildCommandListResponse({
      commands: [],
      limit: 10,
      offset: 0,
      query: "compact",
    });

    expect(response.commands).toEqual([
      {
        name: "compact",
        source: "command",
        origin: "builtin",
        description: "Compact context",
        argumentHint: null,
      },
    ]);
    expect(response.truncated).toBe(false);
  });

  it("keeps the built-in compact row when project commands collide", () => {
    const response = buildCommandListResponse({
      commands: [
        {
          name: "compact",
          source: "command",
          origin: "project",
          description: "Project compact command",
          argumentHint: "<target>",
        },
      ],
      limit: 10,
      offset: 0,
      query: "compact",
    });

    expect(response.commands).toEqual([
      {
        name: "compact",
        source: "command",
        origin: "builtin",
        description: "Compact context",
        argumentHint: null,
      },
    ]);
  });

  it("matches namespaced skills by their direct skill name", () => {
    const response = buildCommandListResponse({
      commands: [
        skill("alpha-review-notes"),
        skill("ottonomous:review"),
        skill("zeta-review"),
      ],
      limit: 1,
      offset: 0,
      query: "review",
    });

    expect(response.commands.map((command) => command.name)).toEqual([
      "ottonomous:review",
    ]);
    expect(response.truncated).toBe(true);
  });

  it("keeps the first user-origin skill when global roots provide the same name", () => {
    const response = buildCommandListResponse({
      commands: [
        skill("bb-cli", { description: "Data-dir override" }),
        skill("bb-cli", { description: "Built-in default" }),
      ],
      limit: 10,
      offset: 0,
      query: "bb-cli",
    });

    expect(response.commands).toEqual([
      {
        name: "bb-cli",
        source: "skill",
        origin: "user",
        description: "Data-dir override",
        argumentHint: null,
      },
    ]);
  });

  it("adds plugin CLI commands in the plugin section", () => {
    const response = buildCommandListResponse({
      commands: [
        skill("review", { origin: "user" }),
        {
          name: "review",
          source: "command",
          origin: "project",
          description: "Legacy review command",
          argumentHint: null,
        },
      ],
      pluginCommands: [
        {
          pluginId: "linear",
          name: "linear",
          summary: "Linear tools",
        },
      ],
      limit: 10,
      offset: 0,
      query: "",
    });

    expect(response.commands.map((command) => command.source)).toEqual([
      "command",
      "skill",
      "plugin",
      "command",
    ]);
    expect(response.commands[2]).toEqual({
      name: "linear",
      source: "plugin",
      origin: "user",
      description: "Linear tools",
      argumentHint: null,
      pluginId: "linear",
    });
    expect(response.truncated).toBe(false);
  });

  it("keeps same-named plugin CLI commands from different plugins", () => {
    const response = buildCommandListResponse({
      commands: [],
      pluginCommands: [
        {
          pluginId: "linear",
          name: "open",
          summary: "Open Linear issue",
        },
        {
          pluginId: "github",
          name: "open",
          summary: "Open GitHub issue",
        },
      ],
      limit: 10,
      offset: 0,
      query: "open",
    });

    expect(response.commands).toEqual([
      {
        name: "open",
        source: "plugin",
        origin: "user",
        description: "Open Linear issue",
        argumentHint: null,
        pluginId: "linear",
      },
      {
        name: "open",
        source: "plugin",
        origin: "user",
        description: "Open GitHub issue",
        argumentHint: null,
        pluginId: "github",
      },
    ]);
  });
});
