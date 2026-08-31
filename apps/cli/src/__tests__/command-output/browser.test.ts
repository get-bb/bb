import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerBrowserCommands } from "../../commands/browser.js";
import { resolveContextSnapshot } from "../../context-env.js";

setupCommandOutputTestEnvironment();
const directories: string[] = [];
const register = (program: Parameters<typeof registerBrowserCommands>[0]) => registerBrowserCommands(program, () => "http://server", () => resolveContextSnapshot());
const target = {
  createdAt: 1,
  hostId: "host-test-001",
  navigating: false,
  navigationEpoch: 0,
  status: "ready" as const,
  targetId: "bt_1",
  threadId: "thread_env",
  updatedAt: 1,
  url: "https://example.test",
  visible: true as const,
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("bb browser", () => {
  it("lists the cohesive command surface without an ignored visible flag", async () => {
    const help = await getHelpOutput(["browser", "--help"], register);
    for (const command of ["open", "list", "navigate", "wait", "snapshot", "click", "type", "press", "select", "screenshot", "close"]) {
      expect(help).toContain(command);
    }
    expect(help).not.toContain("--visible");
  });

  it("uses --thread over validated context and sends trusted local caller host", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread_env");
    const open = vi.fn(async () => target);
    stubServerApi({ "v1.browser.targets.$post": open });
    await runCommand(["browser", "open", "https://example.test", "--thread", "thread_flag", "--json"], register);
    expect(open).toHaveBeenCalledWith({ json: { callerHostId: "host-test-001", threadId: "thread_flag", timeoutMs: undefined, url: "https://example.test" } });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual(target);
  });

  it("rejects a missing or invalid thread before an API call", async () => {
    const list = vi.fn();
    stubServerApi({ "v1.browser.targets.$get": list });
    await expect(runCommand(["browser", "list", "--json"], register)).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith("Error: Missing thread ID. Pass --thread <id> or set BB_THREAD_ID.");
    expect(list).not.toHaveBeenCalled();

    vi.stubEnv("BB_THREAD_ID", "bad/thread");
    await expect(runCommand(["browser", "list", "--json"], register)).rejects.toThrow("process.exit:1");
    expect(list).not.toHaveBeenCalled();
  });

  it("derives the required snapshot generation from the current ref", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread_env");
    const run = vi.fn(async () => ({ kind: "state", navigationEpoch: 0, ready: true, url: "https://example.test" }));
    stubServerApi({ "v1.browser.targets.:targetId.commands.$post": run });
    await runCommand(["browser", "click", "bt_1", "--ref", "e2g7r9", "--json"], register);
    expect(run).toHaveBeenCalledWith({
      json: {
        callerHostId: "host-test-001",
        command: { kind: "click", ref: "e2g7r9", snapshotGeneration: 7 },
        threadId: "thread_env",
        timeoutMs: undefined,
      },
      param: { targetId: "bt_1" },
    });
  });

  it("materializes screenshot bytes without printing base64", async () => {
    const storage = await mkdtemp(join(tmpdir(), "bb-browser-cli-"));
    directories.push(storage);
    vi.stubEnv("BB_THREAD_ID", "thread_env");
    vi.stubEnv("BB_THREAD_STORAGE", storage);
    const artifact = { artifactId: "bs_12345678-1234-1234-1234-123456789abc", byteSize: 8, createdAt: 1, mimeType: "image/png", targetId: "bt_1", threadId: "thread_env" };
    stubServerApi({
      "v1.browser.targets.:targetId.commands.$post": vi.fn(async () => ({ kind: "screenshot", artifact })),
      "v1.browser.artifacts.:artifactId.content.$get": vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))),
    });
    await runCommand(["browser", "screenshot", "bt_1", "--json"], register);
    const output = collectLogPayloads(vi.mocked(console.log)).join("\n");
    expect(output).not.toContain("base64");
    const parsed = JSON.parse(output);
    expect(parsed.path).toBe(join(storage, "browser-screenshots", `${artifact.artifactId}.png`));
    expect(await readFile(parsed.path)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
