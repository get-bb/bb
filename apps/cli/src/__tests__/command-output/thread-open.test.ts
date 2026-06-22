import { describe, expect, it, vi } from "vitest";
import type { Environment, ThreadListEntry } from "@bb/domain";
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

interface ThreadEntryArgs extends Partial<ThreadListEntry> {
  environmentId: string | null;
  id: string;
  projectId: string;
}

function makeThreadEntry(args: ThreadEntryArgs): ThreadListEntry {
  const { id, projectId, providerId, ...overrides } = args;
  const thread = fixtures.makeThread({
    ...overrides,
    id,
    projectId,
    providerId: providerId ?? "codex",
  });
  return {
    ...thread,
    runtime: {
      displayStatus: thread.status,
      hostReconnectGraceExpiresAt: null,
    },
    pinSortKey: null,
    hasPendingInteraction: false,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundSubagentCount: 0,
    },
    environmentHostId: args.environmentId ? "host-test-001" : null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
  };
}

function stubThreadResolverApi(args: {
  environments: Record<string, Environment>;
  threads: ThreadListEntry[];
}) {
  const listThreads = vi.fn(async () => args.threads);
  const getEnvironment = vi.fn(async (request: unknown) => {
    const environmentId = (request as { param: { id: string } }).param.id;
    const environment = args.environments[environmentId];
    if (!environment) {
      throw new Error(`missing test environment ${environmentId}`);
    }
    return environment;
  });
  stubServerApi({
    "v1.threads.$get": listThreads,
    "v1.environments.:id.$get": getEnvironment,
  });
  return { getEnvironment, listThreads };
}

describe("bb thread open command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("resolves a relative path from process.cwd and prints the matching thread URL", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/Users/sawyerhood/project");
    const environment = fixtures.makeEnvironment({
      id: "env-1",
      projectId: "proj-1",
      hostId: "host-test-001",
      path: "/Users/sawyerhood/project/workspaces/thread-a",
    });
    const { getEnvironment, listThreads } = stubThreadResolverApi({
      environments: { "env-1": environment },
      threads: [
        makeThreadEntry({
          id: "thread-1",
          projectId: "proj-1",
          environmentId: "env-1",
        }),
      ],
    });

    await runCommand(
      ["thread", "open", "workspaces/thread-a/src/index.ts"],
      register,
    );

    expect(listThreads).toHaveBeenCalledWith({ query: {} });
    expect(getEnvironment).toHaveBeenCalledWith({ param: { id: "env-1" } });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thread-1",
      "Project: proj-1",
      "Workspace: /Users/sawyerhood/project/workspaces/thread-a",
      "URL: http://server/projects/proj-1/threads/thread-1",
    ]);
  });

  it("leaves absolute paths absolute and returns the resolved match as JSON", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/Users/sawyerhood/elsewhere");
    const environment = fixtures.makeEnvironment({
      id: "env-absolute",
      projectId: "proj-absolute",
      hostId: "host-test-001",
      path: "/tmp/bb-workspaces/thread-b",
    });
    stubThreadResolverApi({
      environments: { "env-absolute": environment },
      threads: [
        makeThreadEntry({
          id: "thread-absolute",
          projectId: "proj-absolute",
          environmentId: "env-absolute",
        }),
      ],
    });

    await runCommand(
      ["thread", "open", "/tmp/bb-workspaces/thread-b/packages/cli", "--json"],
      register,
    );

    const payloads = collectLogPayloads(vi.mocked(console.log));
    expect(payloads.join("\n")).toContain(
      '"resolvedPath": "/tmp/bb-workspaces/thread-b/packages/cli"',
    );
    expect(payloads.join("\n")).toContain('"threadId": "thread-absolute"');
    expect(payloads.join("\n")).toContain(
      '"url": "http://server/projects/proj-absolute/threads/thread-absolute"',
    );
  });

  it("uses the longest matching workspace path", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/tmp");
    const parentEnvironment = fixtures.makeEnvironment({
      id: "env-parent",
      projectId: "proj-parent",
      hostId: "host-test-001",
      path: "/tmp/workspaces",
    });
    const childEnvironment = fixtures.makeEnvironment({
      id: "env-child",
      projectId: "proj-child",
      hostId: "host-test-001",
      path: "/tmp/workspaces/thread-c",
    });
    stubThreadResolverApi({
      environments: {
        "env-parent": parentEnvironment,
        "env-child": childEnvironment,
      },
      threads: [
        makeThreadEntry({
          id: "thread-parent",
          projectId: "proj-parent",
          environmentId: "env-parent",
        }),
        makeThreadEntry({
          id: "thread-child",
          projectId: "proj-child",
          environmentId: "env-child",
        }),
      ],
    });

    await runCommand(["thread", "open", "workspaces/thread-c/src"], register);

    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Thread: thread-child",
    );
  });

  it("does not accept the old positional thread id", async () => {
    stubThreadResolverApi({ environments: {}, threads: [] });

    await expect(
      runCommand(["thread", "open", "src/a.ts", "thread-1"], register),
    ).rejects.toThrow("process.exit:1");
  });

  it("documents the path-only command shape", async () => {
    const help = await getHelpOutput(["thread", "open"], register);

    expect(help).toContain("Usage:");
    expect(help).toContain("<path>");
    expect(help).toContain("Find the BB thread for a workspace path");
    expect(help).not.toContain("--source");
    expect(help).not.toContain("--line");
    expect(help).not.toContain("--self");
  });
});
