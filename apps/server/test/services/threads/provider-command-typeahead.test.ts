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
});
