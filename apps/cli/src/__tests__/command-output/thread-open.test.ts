import { describe, expect, it, vi } from "vitest";
import type { Environment, Thread } from "@bb/domain";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import * as fixtures from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

type OpenThreadHandler = (
  request: unknown,
) => Promise<{ delivered: number }> | { delivered: number };

function stubThreadOpenApi(args: {
  environments?: Record<string, Environment>;
  open?: OpenThreadHandler;
  threads?: Record<string, Thread>;
}) {
  const getThread = vi.fn(async (request: unknown) => {
    const threadId = (request as { param: { id: string } }).param.id;
    const thread = args.threads?.[threadId];
    if (!thread) {
      throw new Error(`missing test thread ${threadId}`);
    }
    return thread;
  });
  const getEnvironment = vi.fn(async (request: unknown) => {
    const environmentId = (request as { param: { id: string } }).param.id;
    const environment = args.environments?.[environmentId];
    if (!environment) {
      throw new Error(`missing test environment ${environmentId}`);
    }
    return environment;
  });
  const openThread = vi.fn(args.open ?? (async () => ({ delivered: 0 })));
  stubServerApi({
    "v1.threads.:id.$get": getThread,
    "v1.environments.:id.$get": getEnvironment,
    "v1.threads.:id.open.$post": openThread,
  });
  return { getEnvironment, getThread, openThread };
}

describe("bb thread open command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("uses BB_THREAD_ID and opens a thread-relative workspace path", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-current");
    const { openThread } = stubThreadOpenApi({
      open: async () => ({ delivered: 2 }),
    });

    await runCommand(["thread", "open", "reports/status.md"], register);

    expect(openThread).toHaveBeenCalledWith({
      param: { id: "thread-current" },
      json: {
        source: "workspace",
        path: "reports/status.md",
        lineNumber: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thread-current",
      "Source: workspace",
      "Path: reports/status.md",
      "Delivered: 2",
    ]);
  });

  it("uses an explicit thread id when BB_THREAD_ID is not set", async () => {
    const { openThread } = stubThreadOpenApi({
      open: async () => ({ delivered: 1 }),
    });

    await runCommand(
      ["thread", "open", "thread-explicit", "reports/status.md"],
      register,
    );

    expect(openThread).toHaveBeenCalledWith({
      param: { id: "thread-explicit" },
      json: {
        source: "workspace",
        path: "reports/status.md",
        lineNumber: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thread-explicit",
      "Source: workspace",
      "Path: reports/status.md",
      "Delivered: 1",
    ]);
  });

  it("resolves an absolute workspace path through the target thread environment", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-workspace");
    const thread = fixtures.makeThread({
      id: "thread-workspace",
      projectId: "proj-workspace",
      providerId: "codex",
      environmentId: "env-workspace",
    });
    const environment = fixtures.makeEnvironment({
      id: "env-workspace",
      projectId: "proj-workspace",
      hostId: "host-test-001",
      path: "/Users/sawyerhood/project/workspaces/thread-workspace",
    });
    const { getEnvironment, getThread, openThread } = stubThreadOpenApi({
      environments: { "env-workspace": environment },
      open: async () => ({ delivered: 1 }),
      threads: { "thread-workspace": thread },
    });

    await runCommand(
      [
        "thread",
        "open",
        "/Users/sawyerhood/project/workspaces/thread-workspace/reports/status.md",
        "--line",
        "7",
      ],
      register,
    );

    expect(getThread).toHaveBeenCalledWith({
      param: { id: "thread-workspace" },
    });
    expect(getEnvironment).toHaveBeenCalledWith({
      param: { id: "env-workspace" },
    });
    expect(openThread).toHaveBeenCalledWith({
      param: { id: "thread-workspace" },
      json: {
        source: "workspace",
        path: "reports/status.md",
        lineNumber: 7,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thread-workspace",
      "Source: workspace",
      "Path: reports/status.md",
      "Line: 7",
      "Delivered: 1",
    ]);
  });

  it("opens an absolute thread-storage path for the current thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-storage");
    vi.stubEnv("BB_THREAD_STORAGE", "/tmp/bb-thread-storage/thread-storage");
    const { getEnvironment, getThread, openThread } = stubThreadOpenApi({
      open: async () => ({ delivered: 1 }),
    });

    await runCommand(
      [
        "thread",
        "open",
        "/tmp/bb-thread-storage/thread-storage/reports/preview.html",
      ],
      register,
    );

    expect(getThread).not.toHaveBeenCalled();
    expect(getEnvironment).not.toHaveBeenCalled();
    expect(openThread).toHaveBeenCalledWith({
      param: { id: "thread-storage" },
      json: {
        source: "thread-storage",
        path: "reports/preview.html",
        lineNumber: null,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thread-storage",
      "Source: thread-storage",
      "Path: reports/preview.html",
      "Delivered: 1",
    ]);
  });

  it("requires an explicit thread id outside a BB thread", async () => {
    stubThreadOpenApi({});

    await expect(
      runCommand(["thread", "open", "reports/status.md"], register),
    ).rejects.toThrow("process.exit:1");
  });

  it("rejects a different explicit thread id when BB_THREAD_ID is set", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-current");
    stubThreadOpenApi({});

    await expect(
      runCommand(
        ["thread", "open", "thread-other", "reports/status.md"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
  });

  it("returns the opened path as JSON", async () => {
    const { openThread } = stubThreadOpenApi({
      open: async () => ({ delivered: 3 }),
    });

    await runCommand(
      ["thread", "open", "thread-explicit", "reports/status.md", "--json"],
      register,
    );

    expect(openThread).toHaveBeenCalledWith({
      param: { id: "thread-explicit" },
      json: {
        source: "workspace",
        path: "reports/status.md",
        lineNumber: null,
      },
    });
    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads.join("\n")).toContain('"threadId": "thread-explicit"');
    expect(payloads.join("\n")).toContain('"source": "workspace"');
    expect(payloads.join("\n")).toContain('"path": "reports/status.md"');
    expect(payloads.join("\n")).toContain('"delivered": 3');
  });

  it("documents the current-thread or explicit-thread command shape", async () => {
    const help = await getHelpOutput(["thread", "open"], register);

    expect(help).toContain("Usage:");
    expect(help).toContain("[id] <path>");
    expect(help).toContain("Open a file in a BB thread panel");
    expect(help).toContain("--line");
    expect(help).not.toContain("--preview");
    expect(help).not.toContain("--source");
    expect(help).not.toContain("--self");
  });
});
