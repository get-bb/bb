import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import {
  AGENT_SURFACE,
  assertAgentSurface,
  DIRECTIVE_IDS,
} from "../../lib/agentic/registry.js";
import type { AgentToolSpec } from "../../lib/agentic/types.js";
import { registerAgentic } from "./register.js";

describe("agent tool registry", () => {
  it("lists sixteen unique fs-prefixed tools and twelve directives", () => {
    const names = Object.keys(AGENT_SURFACE.tools);

    expect(names).toHaveLength(16);
    expect(new Set(names).size).toBe(16);
    expect(names.every((name) => name.startsWith("fs_"))).toBe(true);
    expect(DIRECTIVE_IDS).toHaveLength(12);
    expect(new Set(DIRECTIVE_IDS).size).toBe(12);
    for (const tool of Object.values(AGENT_SURFACE.tools)) {
      if ("directive" in tool) expect(DIRECTIVE_IDS).toContain(tool.directive);
    }
  });

  it("only the three enumerated tools have action class and canonical access", () => {
    const actions = Object.values(AGENT_SURFACE.tools)
      .filter((tool) => tool.class === "action")
      .map((tool) => [tool.name, tool.server]);

    expect(actions).toEqual([
      ["fs_verification_run", "invoke"],
      ["fs_bench_run", "invoke"],
      ["fs_firmware_materialize", "read-fetch"],
    ]);
  });

  it("rejects a fourth server action without an amendment", () => {
    const extraAction: AgentToolSpec = {
      name: "fs_unreviewed_action",
      class: "action",
      server: "invoke",
      idempotency: "non-idempotent",
    };

    expect(() =>
      assertAgentSurface({
        tools: { ...AGENT_SURFACE.tools, [extraAction.name]: extraAction },
        directives: DIRECTIVE_IDS,
      }),
    ).toThrow(/amendment/u);
  });

  it("contains no registered or advertised agent mutation capability", () => {
    const forbiddenName = ["fs_sync", "push"].join("_");
    const host = createFakePluginHost({ pluginId: "finite-state" });

    registerAgentic(host.bb, createPluginContext(host.bb));

    expect(Object.keys(AGENT_SURFACE.tools)).not.toContain(forbiddenName);
    expect(
      host.harness.inspection.registrations.agentTools.map((tool) => tool.name),
    ).not.toContain(forbiddenName);
  });
});
