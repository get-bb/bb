import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
} from "../helpers/command-output-harness.js";
import { registerGuideCommand } from "../../commands/guide.js";

describe("bb guide command output", () => {
  setupCommandOutputTestEnvironment();

  it("bb guide schedules prints the thread schedules chapter", async () => {
    await runCommand(["guide", "schedules"], registerGuideCommand);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toContain("Thread schedules");
    expect(output).toContain("bb thread schedule create");
    expect(output).toContain("Schedule names are unique per thread.");
  });

  it("bb guide async aliases to the thread schedules chapter", async () => {
    await runCommand(["guide", "async"], registerGuideCommand);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).toContain("Thread schedules");
    expect(output).toContain("bb thread schedule create");
  });

  it("bb guide unknown chapter lists available chapters", async () => {
    await expect(
      runCommand(["guide", "missing"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown guide chapter 'missing'");
    expect(errorOutput).toContain(
      "Available: threads, environments, providers, projects, schedules, async.",
    );
  });
});
