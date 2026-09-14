import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createGitGraphPlugin } from "./server.js";
import {
  gitGraphRpcContract,
  overviewOutputSchema,
  projectsOutputSchema,
} from "./contract.js";
import { gitGraphHostContract } from "./host-contract.js";
import { hostScanOutputSchema } from "./git/schemas.js";

const ROOT = "C:/checkouts/widgets";
const SECOND_ROOT = "C:/other/checkout";
const HOST = "host_1";
const SECOND_HOST = "host_2";

interface HostScriptEntry {
  method: string;
  output: unknown;
}

interface ProjectFixture {
  id: string;
  name: string;
  sources: Array<{
    id: string;
    path: string;
    hostId: string;
    isDefault?: boolean;
  }>;
}

interface FakeHostOptions {
  hostScript: readonly HostScriptEntry[];
  projects?: ProjectFixture[];
  hostNames?: Record<string, string>;
}

const DEFAULT_PROJECT: ProjectFixture = {
  id: "proj_1",
  name: "Widgets",
  sources: [{ id: "src_1", path: ROOT, hostId: HOST, isDefault: true }],
};

async function loadPlugin(options: FakeHostOptions): Promise<{
  bb: BbPluginApi;
  harness: ReturnType<typeof createFakePluginHost>["harness"];
}> {
  const host = createFakePluginHost({
    pluginId: "git-graph",
    sdk: {
      projects: {
        list: async () =>
          (options.projects ?? [DEFAULT_PROJECT]).map((project) => ({
            id: project.id,
            kind: "standard",
            name: project.name,
            gitRemoteUrl: null,
            createdAt: 0,
            updatedAt: 0,
            sources: project.sources.map((source, index) => ({
              id: source.id,
              projectId: project.id,
              isDefault: source.isDefault === true || index === 0,
              createdAt: 0,
              updatedAt: 0,
              type: "local_path",
              hostId: source.hostId,
              path: source.path,
            })),
          })),
      },
      hosts: {
        list: async () =>
          Object.entries(options.hostNames ?? { [HOST]: "Office PC" }).map(
            ([id, name]) => ({ id, name }),
          ),
      },
    },
    experimental_callHostRpc: async ({ method }) => {
      const entry = options.hostScript.find(
        (candidate) => candidate.method === method,
      );
      if (entry === undefined) {
        throw new Error(`unexpected host rpc "${method}"`);
      }
      return entry.output;
    },
  });
  await createGitGraphPlugin()(host.bb);
  return { bb: host.bb, harness: host.harness };
}

const scanOutput = hostScanOutputSchema.parse({
  repos: [
    {
      relPath: "",
      position: "root",
      gitLink: "direct",
      head: { abbrev: "aaaa123", branch: "main", detached: false },
      empty: false,
      error: null,
    },
    {
      relPath: "tools/cli",
      position: "nested",
      gitLink: "direct",
      head: { abbrev: "bbbb456", branch: null, detached: true },
      empty: false,
      error: null,
    },
  ],
  scanTruncated: false,
  scanError: null,
});

const historyOutput = {
  commits: [
    {
      hash: "aaaaaaaa",
      abbrev: "aaaa123",
      parents: [],
      subject: "Initial",
      authorName: "Alice",
      authorEmail: "a@e",
      authorDate: "2026-09-01T10:00:00Z",
      refs: [] as [],
    },
  ],
  empty: false,
};

const repoStatusOutput = {
  dirty: {
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
    total: 3,
    truncated: false,
  },
  branches: [
    {
      fullName: "refs/heads/main",
      shortName: "main",
      isRemote: false,
      isHead: true,
    },
  ],
  branchCount: 2,
  tagCount: 1,
  remoteRefCount: 1,
  error: null,
};

function hostCallsOf(harness: {
  inspection: {
    experimental_hostRpcCalls: readonly {
      method: string;
      hostId: string;
      input: unknown;
    }[];
  };
}): readonly {
  method: string;
  hostId: string;
  input: unknown;
}[] {
  return harness.inspection.experimental_hostRpcCalls;
}

describe("git-graph server routing", () => {
  it("lists projects with source folders and host names", async () => {
    const { harness } = await loadPlugin({ hostScript: [] });
    const raw = await harness.behavior.callRpc("projects", null);
    const result = projectsOutputSchema.parse(raw);
    expect(result.projects[0]?.sources[0]).toMatchObject({
      id: "src_1",
      path: ROOT,
      hostId: HOST,
      hostName: "Office PC",
      isDefault: true,
    });
  });

  it("routes repository scanning to the source's host", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
    });
    const raw = await harness.behavior.callRpc("overview", {
      projectId: "proj_1",
    });
    const result = overviewOutputSchema.parse(raw);
    expect(result.source).toMatchObject({
      path: ROOT,
      hostId: HOST,
      hostName: "Office PC",
    });
    expect(result.repos).toHaveLength(2);
    const scanCalls = hostCallsOf(harness).filter(
      (call) => call.method === "scanRepos",
    );
    expect(scanCalls).toHaveLength(1);
    expect(scanCalls[0]?.hostId).toBe(HOST);
    expect(scanCalls[0]?.input).toEqual({ sourceRoot: ROOT });
  });

  it("routes status and history to the source's host with scoped inputs", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "scanRepos", output: scanOutput },
        { method: "repoStatus", output: repoStatusOutput },
        { method: "history", output: historyOutput },
      ],
    });
    await harness.behavior.callRpc("overview", { projectId: "proj_1" });
    await harness.behavior.callRpc("repoStatus", {
      projectId: "proj_1",
      repoRelPath: "",
    });
    const raw = await harness.behavior.callRpc("history", {
      projectId: "proj_1",
      repoRelPath: "",
      offset: 0,
      limit: 50,
    });
    expect(raw).toEqual(historyOutput);
    const calls = hostCallsOf(harness);
    expect(calls.map((call) => call.hostId)).toEqual(calls.map(() => HOST));
    expect(calls.map((call) => call.method)).toEqual([
      "scanRepos",
      "repoStatus",
      "history",
    ]);
    expect(calls[1]?.input).toEqual({
      sourceRoot: ROOT,
      repoRelPath: "",
    });
    expect(calls[2]?.input).toEqual({
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 50,
      includeRemotes: false,
      refs: [],
    });
  });

  it("selects the requested source and routes to its own host", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
      projects: [
        {
          id: "proj_multi",
          name: "Multi",
          sources: [
            { id: "src_a", path: ROOT, hostId: HOST, isDefault: true },
            { id: "src_b", path: SECOND_ROOT, hostId: SECOND_HOST },
          ],
        },
      ],
      hostNames: { [HOST]: "Office PC", [SECOND_HOST]: "Laptop" },
    });
    const raw = await harness.behavior.callRpc("overview", {
      projectId: "proj_multi",
      sourceId: "src_b",
    });
    const result = overviewOutputSchema.parse(raw);
    expect(result.source).toMatchObject({
      id: "src_b",
      path: SECOND_ROOT,
      hostId: SECOND_HOST,
      hostName: "Laptop",
    });
    const scanCall = hostCallsOf(harness).find(
      (call) => call.method === "scanRepos",
    );
    expect(scanCall?.hostId).toBe(SECOND_HOST);
    expect(scanCall?.input).toEqual({ sourceRoot: SECOND_ROOT });
  });

  it("rejects a source that does not belong to the project", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
    });
    await expect(
      harness.behavior.callRpc("overview", {
        projectId: "proj_1",
        sourceId: "src_unknown",
      }),
    ).rejects.toThrow(/is not part of project/u);
    expect(
      hostCallsOf(harness).filter((call) => call.method === "scanRepos"),
    ).toHaveLength(0);
  });

  it("forwards the selected branches and remote toggle to the host", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "scanRepos", output: scanOutput },
        { method: "history", output: historyOutput },
      ],
    });
    await harness.behavior.callRpc("overview", { projectId: "proj_1" });
    await harness.behavior.callRpc("history", {
      projectId: "proj_1",
      repoRelPath: "",
      offset: 0,
      limit: 50,
      refs: ["refs/heads/feature", "refs/remotes/origin/main"],
      includeRemotes: true,
    });
    const historyCall = hostCallsOf(harness).find(
      (call) => call.method === "history",
    );
    expect(historyCall?.input).toEqual({
      sourceRoot: ROOT,
      repoRelPath: "",
      offset: 0,
      limit: 50,
      refs: ["refs/heads/feature", "refs/remotes/origin/main"],
      includeRemotes: true,
    });
  });

  it("caches the overview per source until refresh is requested", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
    });
    await harness.behavior.callRpc("overview", { projectId: "proj_1" });
    await harness.behavior.callRpc("overview", { projectId: "proj_1" });
    expect(
      hostCallsOf(harness).filter((call) => call.method === "scanRepos"),
    ).toHaveLength(1);
    await harness.behavior.callRpc("overview", {
      projectId: "proj_1",
      refresh: true,
    });
    expect(
      hostCallsOf(harness).filter((call) => call.method === "scanRepos"),
    ).toHaveLength(2);
  });

  it("rejects malformed repository and file paths before any host call", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
    });
    await expect(
      harness.behavior.callRpc("history", {
        projectId: "proj_1",
        repoRelPath: "a/../../climb",
        offset: 0,
        limit: 10,
      }),
    ).rejects.toThrow(/Invalid repository path/u);
    for (const path of ["../outside.txt", "-C", "C:\\windows\\x"]) {
      await expect(
        harness.behavior.callRpc("filePatch", {
          projectId: "proj_1",
          repoRelPath: "",
          hash: "aaaaaaaa",
          path,
        }),
      ).rejects.toThrow(/Invalid repository file path/u);
    }
    expect(
      hostCallsOf(harness).filter((call) => call.method !== "scanRepos"),
    ).toHaveLength(0);
  });

  it("validates commit hashes and page sizes through the contract", async () => {
    const { harness } = await loadPlugin({
      hostScript: [{ method: "scanRepos", output: scanOutput }],
    });
    await expect(
      harness.behavior.callRpc("commitDetail", {
        projectId: "proj_1",
        repoRelPath: "",
        hash: "--exec=evil",
      }),
    ).rejects.toThrow();
    await expect(
      harness.behavior.callRpc("history", {
        projectId: "proj_1",
        repoRelPath: "",
        offset: 0,
        limit: 500,
      }),
    ).rejects.toThrow();
  });

  it("serves the CLI from the routed host", async () => {
    const { harness } = await loadPlugin({
      hostScript: [
        { method: "scanRepos", output: scanOutput },
        { method: "history", output: historyOutput },
      ],
    });
    const repos = await harness.behavior.runCli(["repos"]);
    expect(repos.exitCode).toBe(0);
    expect(repos.stdout).toContain("(project root)");
    expect(repos.stdout).toContain("main");
    expect(repos.stdout).toContain("Office PC");
    const log = await harness.behavior.runCli(["log", "5"]);
    expect(log.exitCode).toBe(0);
    expect(log.stdout).toContain("Initial");
    expect(hostCallsOf(harness).every((call) => call.hostId === HOST)).toBe(
      true,
    );
  });

  it("rejects unknown CLI subcommands", async () => {
    const { harness } = await loadPlugin({ hostScript: [] });
    const result = await harness.behavior.runCli(["frobnicate"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand");
  });
});

describe("git-graph server entry architecture", () => {
  const serverSource = readFileSync(
    fileURLToPath(new URL("./server.ts", import.meta.url)),
    "utf8",
  );

  it("never touches local processes or the local filesystem", () => {
    expect(serverSource).not.toMatch(/node:child_process/u);
    expect(serverSource).not.toMatch(/from "node:fs/u);
    expect(serverSource).not.toContain("createNodeGitRunner");
    expect(serverSource).not.toContain("nodeFsReader");
    expect(serverSource).not.toContain("createGitGraphService");
    expect(serverSource).not.toContain("execFile");
  });

  it("reaches Git only through the typed host client", () => {
    expect(serverSource).toContain("experimental_client");
    expect(serverSource).toContain("gitGraphHostContract");
    expect(serverSource).toContain("hostId: source.hostId");
  });

  it("keeps the browser contract and the host contract aligned", () => {
    expect(Object.keys(gitGraphHostContract).sort()).toEqual(
      [
        "commitDetail",
        "filePatch",
        "history",
        "repoStatus",
        "scanRepos",
      ].sort(),
    );
    const browserMethods = [
      "repoStatus",
      "history",
      "commitDetail",
      "filePatch",
    ] as const;
    for (const method of browserMethods) {
      expect(gitGraphRpcContract[method]).toBeDefined();
    }
  });
});
