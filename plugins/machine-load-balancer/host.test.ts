import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import hostEntry from "./host.js";

describe("Machine measurement host entry", () => {
  it("measures this machine's real capacity and load", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    const measurement = await harness.experimental_call("measure", null);
    expect(measurement.capacity.availableParallelism).toBeGreaterThan(0);
    expect(measurement.capacity.totalMemoryBytes).toBeGreaterThan(0);
    expect(measurement.oneMinuteLoad.kind).toBe(
      process.platform === "win32" ? "unsupported" : "measured",
    );
    await harness.experimental_dispose();
  });

  it("accepts only an existing directory as a project source", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-placement-source-"));
    const harness = experimental_createHostEntryHarness(hostEntry);
    try {
      const file = join(root, "file.txt");
      await writeFile(file, "x");
      await expect(harness.experimental_call("checkSource", { path: root })).resolves.toEqual({ kind: "available" });
      await expect(harness.experimental_call("checkSource", { path: file })).resolves.toEqual({ kind: "missing" });
      await expect(harness.experimental_call("checkSource", { path: join(root, "gone") })).resolves.toEqual({ kind: "missing" });
      await expect(harness.experimental_call("checkSource", { path: join(root, "x".repeat(5000)) }))
        .resolves.toMatchObject({ kind: "failed", reason: expect.stringContaining("ENAMETOOLONG") });
    } finally {
      await harness.experimental_dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
