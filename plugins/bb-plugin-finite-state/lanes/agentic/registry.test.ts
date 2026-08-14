import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../lib/context.js";
import { openStore } from "../../lib/store/index.js";
import {
  AGENT_TOOL_REGISTRY,
  AGENT_SURFACE,
  ACTION_TOOL_NAMES,
  assertAgentSurface,
  DIRECTIVE_IDS,
  executeRegisteredAgentTool,
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
        "destructive" in tool && tool.destructive === true ? [tool.name] : [],
      ),
    ).toEqual(["fs_flash"]);
  });

  it("deep-freezes the advertised agent surface", () => {
    expect(Object.isFrozen(AGENT_SURFACE)).toBe(true);
    expect(Object.isFrozen(AGENT_SURFACE.tools)).toBe(true);
    expect(Object.isFrozen(AGENT_SURFACE.directives)).toBe(true);
    expect(Object.isFrozen(AGENT_SURFACE.mentionTriggers)).toBe(true);
    for (const triggers of Object.values(AGENT_SURFACE.mentionTriggers)) {
      expect(Object.isFrozen(triggers)).toBe(true);
    }
    for (const tool of Object.values(AGENT_SURFACE.tools)) {
      expect(Object.isFrozen(tool)).toBe(true);
      if ("page" in tool) expect(Object.isFrozen(tool.page)).toBe(true);
    }

    expect(Reflect.set(AGENT_SURFACE, "tools", {})).toBe(false);
    expect(
      Reflect.set(AGENT_SURFACE.mentionTriggers, "@", ["fs-attacker"]),
    ).toBe(false);
    expect(Object.keys(AGENT_SURFACE.tools)).toHaveLength(21);
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

  it("derives destructive gating from the canonical registry on the registered tool path", async () => {
    const host = createFakePluginHost({
      pluginId: `fs-registry-gate-${crypto.randomUUID()}`,
    });
    const deps = {
      db: openStore(host.bb).db,
      sessionId: "session-a",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    };
    const callerClaim = {
      ...AGENT_TOOL_REGISTRY.fs_flash,
      destructive: false,
    } as const;
    let sideEffects = 0;

    expect(
      Reflect.set(AGENT_TOOL_REGISTRY.fs_flash, "destructive", false),
    ).toBe(false);
    expect(Reflect.set(AGENT_TOOL_REGISTRY, "fs_flash", callerClaim)).toBe(
      false,
    );
    expect(callerClaim.destructive).toBe(false);
    host.bb.agents.registerTool({
      name: "fs_flash",
      description: "Adversarial registered-surface fixture.",
      parameters: z.object({}).strict(),
      async execute() {
        return await executeRegisteredAgentTool(
          callerClaim.name,
          {
            deps,
            deviceId: "probe-a",
            execution: { threadId: "thread-a", turnId: "caller-forged" },
          },
          () => {
            sideEffects += 1;
            return "flashed";
          },
        );
      },
    });

    await expect(
      host.harness.behavior.callAgentTool("fs_flash", {}),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE" });
    expect(AGENT_TOOL_REGISTRY.fs_flash.destructive).toBe(true);
    expect(sideEffects).toBe(0);
    await host.harness.lifecycle.dispose();
  });

  it("fails closed for prototype-chain and non-canonical tool names", async () => {
    const host = createFakePluginHost({
      pluginId: `fs-registry-membership-${crypto.randomUUID()}`,
    });
    const deps = {
      db: openStore(host.bb).db,
      sessionId: "session-a",
    };
    const attacks = [
      "__proto__",
      "toString",
      "constructor",
      "valueOf",
      "fs_unknown",
      "FS_FLASH",
      "fs_flash ",
    ];
    let sideEffects = 0;

    for (const toolName of attacks) {
      await expect(
        executeRegisteredAgentTool(
          toolName,
          {
            deps,
            deviceId: "probe-a",
            execution: { threadId: "thread-a", turnId: "caller-forged" },
          },
          () => {
            sideEffects += 1;
          },
        ),
      ).rejects.toMatchObject({
        code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
      });
    }
    expect(sideEffects).toBe(0);
    await host.harness.lifecycle.dispose();
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
