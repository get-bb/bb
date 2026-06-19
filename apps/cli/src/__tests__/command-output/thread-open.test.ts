import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread open command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("posts a workspace open request and prints the delivered count as JSON", async () => {
    const open = vi.fn(async () => ({ delivered: 2 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await runCommand(
      ["thread", "open", "src/index.ts", "thread-1", "--json"],
      register,
    );

    expect(open).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: { source: "workspace", path: "src/index.ts", lineNumber: null },
    });
    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads.join("\n")).toContain('"delivered": 2');
  });

  it("passes --line and --source through to the request", async () => {
    const open = vi.fn(async () => ({ delivered: 1 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await runCommand(
      [
        "thread",
        "open",
        "notes/plan.md",
        "thread-1",
        "--source",
        "thread-storage",
        "--line",
        "42",
      ],
      register,
    );

    expect(open).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: {
        source: "thread-storage",
        path: "notes/plan.md",
        lineNumber: 42,
      },
    });
    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.some((line) => line.includes("Opened notes/plan.md"))).toBe(
      true,
    );
  });

  it("resolves the thread from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-env");
    const open = vi.fn(async () => ({ delivered: 1 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await runCommand(["thread", "open", "src/a.ts"], register);

    expect(open).toHaveBeenCalledWith({
      param: { id: "thread-env" },
      json: { source: "workspace", path: "src/a.ts", lineNumber: null },
    });
  });

  it("reports when no client is connected", async () => {
    const open = vi.fn(async () => ({ delivered: 0 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await runCommand(["thread", "open", "src/a.ts", "thread-1"], register);

    const lines = collectLogLines(vi.mocked(console.log));
    expect(lines.some((line) => line.includes("No bb app is connected"))).toBe(
      true,
    );
  });

  it("errors without a thread when BB_THREAD_ID is unset", async () => {
    const open = vi.fn(async () => ({ delivered: 0 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await expect(
      runCommand(["thread", "open", "src/a.ts"], register),
    ).rejects.toThrow("process.exit:1");
    expect(open).not.toHaveBeenCalled();
  });

  it("rejects an invalid --source", async () => {
    const open = vi.fn(async () => ({ delivered: 0 }));
    stubServerApi({ "v1.threads.:id.open.$post": open });

    await expect(
      runCommand(
        ["thread", "open", "src/a.ts", "thread-1", "--source", "bogus"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(open).not.toHaveBeenCalled();
  });
});
