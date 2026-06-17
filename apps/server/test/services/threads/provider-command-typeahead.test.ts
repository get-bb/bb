import type { HostProviderCommand } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { buildCommandListResponse } from "../../../src/services/threads/provider-command-typeahead.js";

function skill(name: string): HostProviderCommand {
  return {
    name,
    source: "skill",
    origin: "user",
    description: null,
    argumentHint: null,
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
});
