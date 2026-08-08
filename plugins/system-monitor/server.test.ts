import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin, { statsSchema } from "./server";

async function loadPlugin() {
  const host = createFakePluginHost({ pluginId: "system-monitor" });
  await plugin(host.bb);
  return host;
}

describe("System Monitor", () => {
  it("returns a schema-valid host snapshot over RPC", async () => {
    const { harness } = await loadPlugin();
    const stats = statsSchema.parse(await harness.callRpc("stats", null));

    expect(stats.hostname).not.toBe("");
    expect(stats.cpu.logicalCores).toBeGreaterThan(0);
    expect(stats.cpu.usagePercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpu.usagePercent).toBeLessThanOrEqual(100);
    expect(stats.memory.totalBytes).toBeGreaterThan(0);
    expect(stats.disk.totalBytes).toBeGreaterThan(0);
    expect(stats.loadAverage).toHaveLength(3);
  });

  it("registers the system-monitor CLI with human and JSON output", async () => {
    const { harness } = await loadPlugin();
    expect(harness.registrations.cli?.name).toBe("system-monitor");

    const human = await harness.runCli([]);
    expect(human).toMatchObject({ exitCode: 0 });
    expect(human.stdout).toContain("CPU");
    expect(human.stdout).toContain("Memory");

    const json = await harness.runCli(["--json"]);
    expect(json.exitCode).toBe(0);
    expect(() => statsSchema.parse(JSON.parse(json.stdout))).not.toThrow();
  });
});
