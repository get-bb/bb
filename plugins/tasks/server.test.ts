import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { TASKS_PLUGIN_VERSION } from "./server";

describe("Tasks plugin scaffold", () => {
  it("registers the CLI and RPC surfaces after opening plugin storage", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });

    await plugin(bb);

    expect(harness.logEntries).toEqual([
      {
        level: "info",
        message: `Tasks ${TASKS_PLUGIN_VERSION} loaded`,
      },
    ]);
    await expect(harness.callRpc("ping", null)).resolves.toEqual({
      ok: true,
      version: TASKS_PLUGIN_VERSION,
    });
    await expect(harness.runCli(["status"])).resolves.toEqual({
      exitCode: 0,
      stdout: `Tasks ${TASKS_PLUGIN_VERSION}`,
      stderr: "",
    });
    await expect(harness.runCli(["status", "--json"])).resolves.toEqual({
      exitCode: 0,
      stdout: JSON.stringify({
        name: "Tasks",
        version: TASKS_PLUGIN_VERSION,
      }),
      stderr: "",
    });

    await harness.dispose();
  });
});
