import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { MAX_CUSTOM_INSTRUCTIONS_LENGTH } from "./server";

describe("custom instructions plugin", () => {
  it("migrates persisted instructions into declarative settings", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "custom-instructions",
    });
    await bb.storage.kv.set("customInstructions", "Use concise answers.");

    await plugin(bb);

    expect(harness.registrations.settingsDescriptors).toEqual({
      instructions: {
        type: "string",
        label: "Custom instructions",
        description:
          "Give agents extra instructions and context for tasks on this bb host.",
        experimental_multiline: true,
        experimental_schema: expect.any(Object),
        default: "",
      },
    });
    await expect(
      bb.storage.kv.get("customInstructions"),
    ).resolves.toBeUndefined();
    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBe("Use concise answers.");
  });

  it("applies declarative settings updates immediately", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "custom-instructions",
    });
    await plugin(bb);

    await harness.setSettings({ instructions: "Always run focused tests." });

    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBe("Always run focused tests.");
  });

  it("provides CLI parity through the declarative setting", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "custom-instructions",
    });
    await plugin(bb);

    await expect(
      harness.runCli(["set", "Prefer", "small", "commits.", "--json"]),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: JSON.stringify({ instructions: "Prefer small commits." }),
    });
    await expect(harness.runCli(["get"])).resolves.toMatchObject({
      exitCode: 0,
      stdout: "Prefer small commits.",
    });
    await expect(
      harness.setSettings({ instructions: "x".repeat(4097) }),
    ).rejects.toThrow("at most 4096 characters");
  });

  it("contributes nothing for blank text and rejects oversized CLI updates", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "custom-instructions",
    });
    await plugin(bb);

    expect(
      harness.registrations.instructionProvider?.({
        threadId: "thr_1",
        projectId: "proj_1",
      }),
    ).toBeNull();
    await expect(
      harness.runCli(["set", "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1)]),
    ).resolves.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining("at most 4096 characters"),
    });
  });

  it("documents set in help, requires its text, accepts dashed text, and reports errors as JSON", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "custom-instructions",
    });
    await plugin(bb);

    const help = (await harness.runCli(["set", "--help"])).stdout;
    expect(help).toContain("bb instructions set");
    expect(help).toContain("at most 4096 characters");

    const dashed = await harness.runCli(["set", "--", "-n", "no flags here"]);
    expect(dashed.exitCode, dashed.stderr).toBe(0);
    await expect(harness.runCli(["get"])).resolves.toMatchObject({
      stdout: "-n no flags here",
    });

    const missingText = await harness.runCli(["set"]);
    expect(missingText.exitCode).toBe(1);
    expect(missingText.stderr).toContain("missing required arguments: <text>");
    await expect(harness.runCli(["get"])).resolves.toMatchObject({
      stdout: "-n no flags here",
    });

    const envelope = await harness.runCli([
      "set",
      "x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 1),
      "--json",
    ]);
    expect(envelope.exitCode).toBe(1);
    expect(JSON.parse(envelope.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "invalid_instructions",
        message: expect.stringContaining("at most 4096 characters"),
      },
    });
  });
});
