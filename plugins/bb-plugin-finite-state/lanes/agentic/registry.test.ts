import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import {
  AGENT_SURFACE,
  ACTION_TOOL_NAMES,
  assertAgentSurface,
  DestructiveInstructionRequiredError,
  DIRECTIVE_IDS,
  executeAgentToolWithDestructiveGate,
} from "../../lib/agentic/registry.js";
import type { AgentToolSpec } from "../../lib/agentic/types.js";
import { registerAgentic } from "./register.js";

describe("agent tool registry", () => {
  it("lists twenty-one unique fs-prefixed tools and twelve directives", () => {
    const names = Object.keys(AGENT_SURFACE.tools);

    expect(names).toHaveLength(21);
    expect(new Set(names).size).toBe(21);
    expect(names.every((name) => name.startsWith("fs_"))).toBe(true);
    expect(DIRECTIVE_IDS).toHaveLength(12);
    expect(new Set(DIRECTIVE_IDS).size).toBe(12);
    for (const tool of Object.values(AGENT_SURFACE.tools)) {
      if ("directive" in tool) expect(DIRECTIVE_IDS).toContain(tool.directive);
    }
  });

  it("has exactly the eight reviewed action tools and canonical access", () => {
    const actions = Object.values(AGENT_SURFACE.tools)
      .filter((tool) => tool.class === "action")
      .map((tool) => [tool.name, tool.server]);

    expect(actions).toEqual([
      ["fs_verification_run", "invoke"],
      ["fs_bench_run", "invoke"],
      ["fs_firmware_materialize", "read-fetch"],
      ["fs_hw_extract", "none"],
      ["fs_build", "none"],
      ["fs_flash", "none"],
      ["fs_serial", "none"],
      ["fs_probe", "none"],
    ]);
    expect(ACTION_TOOL_NAMES).toEqual(actions.map(([name]) => name));
    expect(
      Object.values(AGENT_SURFACE.tools).flatMap((tool) =>
        "destructive" in tool && tool.destructive === true ? [tool.name] : []),
    ).toEqual(["fs_flash"]);
  });

  it("rejects a ninth action without an amendment", () => {
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

  it("gates destructive tools on an explicit human instruction in the current turn", () => {
    let executions = 0;
    const executeFlash = (
      instruction: { source: "human" | "plan"; turnId: string } | null,
    ) =>
      executeAgentToolWithDestructiveGate(
        "fs_flash",
        {
          currentTurnId: "turn-current",
          instruction,
        },
        () => {
          executions += 1;
          return "flashed" as const;
        },
      );

    expect(() => executeFlash(null)).toThrow(
      DestructiveInstructionRequiredError,
    );
    expect(() => executeFlash({ source: "plan", turnId: "turn-current" })).toThrow(
      DestructiveInstructionRequiredError,
    );
    expect(() => executeFlash({ source: "human", turnId: "turn-prior" })).toThrow(
      /current turn/u,
    );
    expect(executions).toBe(0);
    expect(executeFlash({ source: "human", turnId: "turn-current" })).toBe("flashed");
    expect(executions).toBe(1);
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
