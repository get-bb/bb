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

  it("bb guide styling redirects to the app chapter", async () => {
    await runCommand(["guide", "styling"], registerGuideCommand);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toContain("Apps");
    expect(output).toContain("Styling:");
    expect(output).toContain("https://cdn.tailwindcss.com");
    expect(output).toContain("@media (prefers-color-scheme: dark)");
  });

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

  it("bb guide app prints the app chapter", async () => {
    await runCommand(["guide", "app"], registerGuideCommand);

    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output.trim().length).toBeGreaterThan(0);
    expect(output).toContain("Apps");
    expect(output).toContain("<dataDir>/apps/<applicationId>/");
    expect(output).toContain("window.bb.data");
    expect(output).toContain("window.bb.message.send");
    expect(output).toContain("bb app current --json");
    expect(output).toContain("Vite + React + TypeScript Todo app");
    expect(output).toContain("pnpm build");
    expect(output).toContain("skills/add-todos/SKILL.md");
  });

  it("bb guide unknown chapter lists styling in available chapters", async () => {
    await expect(
      runCommand(["guide", "missing"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown guide chapter 'missing'");
    expect(errorOutput).toContain(
      "Available: threads, environments, app, providers, projects, styling, schedules, async.",
    );
  });
});
