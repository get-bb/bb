import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  assertDebugModeFeasibility,
  DEBUG_MODE_FEASIBILITY,
} from "./feasibility.js";

describe("debug-mode feasibility", () => {
  it("uses handler refusal as the enforceable plugin-only floor", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-feasibility-refusal" });
    let sideEffects = 0;
    let enabled = false;
    host.bb.agents.registerTool({
      name: "fixture_instrument",
      description: "Fixture instrument",
      parameters: z.object({}),
      execute() {
        if (!enabled) return "DEBUG_MODE_REQUIRED";
        sideEffects += 1;
        return "executed";
      },
    });

    await expect(host.harness.callAgentTool("fixture_instrument", {}))
      .resolves.toBe("DEBUG_MODE_REQUIRED");
    expect(sideEffects).toBe(0);
    enabled = true;
    await expect(host.harness.callAgentTool("fixture_instrument", {})).resolves.toBe("executed");
    expect(sideEffects).toBe(1);
  });

  it("selects registered instrument tools only at session resolution", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-feasibility-session" });
    const debugThreads = new Set<string>();
    host.bb.agents.registerTool({
      name: "fixture_instrument",
      description: "Fixture instrument",
      parameters: z.object({}),
      execute: () => "ok",
    });
    host.bb.agents.configure((context) => ({
      tools: debugThreads.has(context.thread.id) ? ["fixture_instrument"] : [],
      skills: [],
    }));
    const context = {
      thread: { id: "thread-a", title: null, parentThreadId: null, sourceThreadId: null },
      project: { id: "project-a", kind: "standard" as const, name: "Project", gitRemoteUrl: null },
      environment: {
        id: "environment-a",
        name: null,
        path: null,
        workspaceProvisionType: "unmanaged" as const,
        branchName: null,
      },
      host: { id: "host-a", name: "Host" },
      provider: { id: "provider-a", model: "model-a" },
      origin: { kind: null, pluginId: null },
    };

    expect((await host.harness.resolveAgentConfiguration(context)).tools).toEqual([]);
    debugThreads.add("thread-a");
    expect((await host.harness.resolveAgentConfiguration(context)).tools.map((tool) => tool.name))
      .toEqual(["fixture_instrument"]);
    expect(host.harness.inspection.registrations.agentTools.map((tool) => tool.name))
      .toEqual(["fixture_instrument"]);
  });

  it("records executable plugin-only verdicts and the unavailable turn signal", () => {
    const host = createFakePluginHost({ pluginId: "finite-state-feasibility-evidence" });
    expect(() => assertDebugModeFeasibility({
      refusalGate: true,
      conditionalToolsAtSessionStart: true,
      hotSessionMutationAttempted: false,
      bbCoreSourceUsed: false,
      interactionResponseSdkCallable:
        typeof host.bb.sdk.threads.interactions.respond === "function",
    })).not.toThrow();
    expect(DEBUG_MODE_FEASIBILITY).toEqual({
      refusalGate: "plugin-handler-precondition",
      conditionalTools: "next-session-resolution",
      hotSessionMutation: false,
      bbCoreChangeRequired: false,
      destructiveTurnEvidence: "unavailable",
      requestInputActorEvidence: "unavailable",
      destructiveEvidenceUnblock: "https://github.com/get-bb/bb/issues/1564",
    });
  });
});
