import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { openStore } from "../../../lib/store/index.js";
import {
  ACTION_TOOL_NAMES,
  AGENT_TOOL_REGISTRY,
  executeRegisteredAgentTool,
  type ActionToolName,
} from "../../../lib/agentic/registry.js";
import { HELPER_INSTALL_OPERATION } from "./destructive.js";
import type { GatingDeps } from "./mode.js";

const ENUMERATED_ACTION_TOOLS = [
  "fs_verification_run",
  "fs_bench_run",
  "fs_firmware_materialize",
  "fs_hw_extract",
  "fs_build",
  "fs_flash",
  "fs_serial",
  "fs_probe",
] as const satisfies readonly ActionToolName[];

const ENUMERATED_ACTION_SET: Record<ActionToolName, true> = {
  fs_verification_run: true,
  fs_bench_run: true,
  fs_firmware_materialize: true,
  fs_hw_extract: true,
  fs_build: true,
  fs_flash: true,
  fs_serial: true,
  fs_probe: true,
};

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});
describe("destructive action allowlist", () => {
  it("exercises every closed action under null and caller-forged turn ids", async () => {
    const host = createFakePluginHost({
      pluginId: `fs-destructive-allowlist-${crypto.randomUUID()}`,
    });
    hosts.push(host);
    const deps: GatingDeps = {
      db: openStore(host.bb).db,
      sessionId: "session-a",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
    };
    const sideEffects = new Map<ActionToolName, number>();

    expect(ENUMERATED_ACTION_TOOLS).toEqual(ACTION_TOOL_NAMES);
    expect(Object.keys(ENUMERATED_ACTION_SET)).toEqual(ACTION_TOOL_NAMES);
    for (const toolName of ENUMERATED_ACTION_TOOLS) {
      const tool = AGENT_TOOL_REGISTRY[toolName];
      const destructive = "destructive" in tool && tool.destructive === true;
      for (const turnId of [null, "caller-forged-turn"] as const) {
        const result = executeRegisteredAgentTool(
          toolName,
          {
            deps,
            deviceId: "device-a",
            execution: { threadId: "thread-a", turnId },
          },
          () => {
            sideEffects.set(toolName, (sideEffects.get(toolName) ?? 0) + 1);
            return toolName;
          },
        );
        if (destructive) {
          await expect(result).rejects.toMatchObject({
            code: "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
          });
        } else {
          await expect(result).resolves.toBe(toolName);
        }
      }
    }
    expect(sideEffects).toEqual(
      new Map(
        ACTION_TOOL_NAMES.filter((toolName) => toolName !== "fs_flash").map(
          (toolName) => [toolName, 2],
        ),
      ),
    );
    expect(sideEffects.has("fs_flash")).toBe(false);
  });

  it("keeps helper install outside the agent registry while using the same gate", () => {
    expect(HELPER_INSTALL_OPERATION).toBe("benchDevHelperInstall");
    expect(HELPER_INSTALL_OPERATION in AGENT_TOOL_REGISTRY).toBe(false);
  });
});
