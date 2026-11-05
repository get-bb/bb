import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { runGit } from "bb-environment-provider-host/git";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import hostEntry from "./host.js";
import { installFakeGh, makeTempDir } from "./test/fake-gh.js";

const execFileAsync = promisify(execFile);

const localBranch = "bb/review-github-issue-1235-thr_test";
const forkRemote = "review-fork";
const upstreamBranch = "per-turn-permission-escalation";
const forkRemoteUrl = "git@github.com:fork-owner/bb.git";

function pullRequestJson(): string {
  return JSON.stringify({
    number: 1236,
    title: "Apply execution settings without replacing sessions",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/1236",
    isDraft: false,
    baseRefName: "main",
    headRefName: upstreamBranch,
    headRefOid: null,
    updatedAt: "2026-08-10T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
}

let repositoryTemplate: string;
let trackedForkRepositoryTemplate: string;
let managedBaseRepositoryTemplate: string;
let untrackedRepositoryTemplate: string;

beforeAll(async () => {
  repositoryTemplate = await fs.mkdtemp(path.join(tmpdir(), "bb-pr-template-"));
  const workspacePath = repositoryTemplate;
  await runGit(["init", "-b", localBranch], { cwd: workspacePath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: workspacePath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: workspacePath,
  });
  await fs.writeFile(path.join(workspacePath, "README.md"), "test\n", "utf8");
  await runGit(["add", "README.md"], { cwd: workspacePath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: workspacePath });
  await runGit(["remote", "add", "origin", "git@github.com:acme/bb.git"], {
    cwd: workspacePath,
  });
  trackedForkRepositoryTemplate = await fs.mkdtemp(
    path.join(tmpdir(), "bb-pr-fork-template-"),
  );
  await fs.cp(repositoryTemplate, trackedForkRepositoryTemplate, {
    recursive: true,
  });
  await runGit(["remote", "add", forkRemote, forkRemoteUrl], {
    cwd: trackedForkRepositoryTemplate,
  });
  await runGit(
    ["update-ref", `refs/remotes/${forkRemote}/${upstreamBranch}`, "HEAD"],
    { cwd: trackedForkRepositoryTemplate },
  );
  await runGit(
    [
      "branch",
      "--set-upstream-to",
      `${forkRemote}/${upstreamBranch}`,
      localBranch,
    ],
    { cwd: trackedForkRepositoryTemplate },
  );
  managedBaseRepositoryTemplate = await fs.mkdtemp(
    path.join(tmpdir(), "bb-pr-base-template-"),
  );
  await fs.cp(repositoryTemplate, managedBaseRepositoryTemplate, {
    recursive: true,
  });
  await runGit(["update-ref", "refs/remotes/origin/main", "HEAD"], {
    cwd: managedBaseRepositoryTemplate,
  });
  await runGit(["branch", "--set-upstream-to", "origin/main", localBranch], {
    cwd: managedBaseRepositoryTemplate,
  });
  untrackedRepositoryTemplate = await fs.mkdtemp(
    path.join(tmpdir(), "bb-pr-untracked-template-"),
  );
  await fs.cp(managedBaseRepositoryTemplate, untrackedRepositoryTemplate, {
    recursive: true,
  });
  await runGit(["branch", "--unset-upstream"], {
    cwd: untrackedRepositoryTemplate,
  });
});

afterAll(async () => {
  for (const template of [
    repositoryTemplate,
    trackedForkRepositoryTemplate,
    managedBaseRepositoryTemplate,
    untrackedRepositoryTemplate,
  ]) {
    if (template) await fs.rm(template, { recursive: true, force: true });
  }
});

async function createRepository(
  prefix: string,
  template = repositoryTemplate,
): Promise<string> {
  const workspacePath = await makeTempDir(prefix);
  await fs.cp(template, workspacePath, { recursive: true });
  return workspacePath;
}

async function createTrackedForkWorkspace(
  remoteUrl = forkRemoteUrl,
): Promise<string> {
  const workspacePath = await createRepository(
    "bb-pr-upstream-workspace-",
    trackedForkRepositoryTemplate,
  );
  if (remoteUrl !== forkRemoteUrl) {
    await runGit(["remote", "set-url", forkRemote, remoteUrl], {
      cwd: workspacePath,
    });
  }
  return workspacePath;
}

async function createManagedBaseTrackedWorkspace(): Promise<string> {
  return createRepository(
    "bb-pr-base-upstream-workspace-",
    managedBaseRepositoryTemplate,
  );
}

function branchLookup(
  nodes: Record<string, unknown>[],
  defaultBranch = "main",
) {
  return {
    "api graphql": {
      stdout: JSON.stringify({
        data: {
          p0: {
            defaultBranchRef: { name: defaultBranch },
            pullRequests: {
              nodes: nodes.map((node) => ({
                ...JSON.parse(pullRequestJson()),
                ...node,
              })),
            },
          },
        },
      }),
    },
  };
}

const found = branchLookup(
  ["fork-owner", "other-owner"].map((owner, index) => ({
    number: 1236 + index,
    isCrossRepository: true,
    headRepositoryOwner: { login: owner },
  })),
);
const sameRepository = branchLookup([
  {
    number: 1235,
    isCrossRepository: true,
    headRepositoryOwner: { login: "stranger" },
  },
  {
    number: 1236,
    isCrossRepository: false,
    headRepositoryOwner: { login: "acme" },
  },
]);

afterEach(() => {
  vi.unstubAllEnvs();
});

const harness = experimental_createHostEntryHarness(hostEntry);

async function view(read: { path: string; refresh: boolean }) {
  const [result] = await harness.experimental_call("views", {
    reads: [{ ...read, known: null }],
  });
  return result?.lookup;
}

describe("pull request lookup for differently named upstream branches", () => {
  it.each(["origin-base", "none"])(
    "uses the managed local branch with %s upstream",
    async (upstream) => {
      const workspacePath =
        upstream === "none"
          ? await createRepository(
              "bb-pr-no-upstream-workspace-",
              untrackedRepositoryTemplate,
            )
          : await createManagedBaseTrackedWorkspace();
      const gh = await installFakeGh(sameRepository);

      await expect(
        view({
          path: workspacePath,
          refresh: false,
        }),
      ).resolves.toMatchObject({
        outcome: "found",
        pullRequest: { number: 1236 },
      });

      expect(await gh.readCalls()).toHaveLength(1);
      expect((await gh.readQueries())[0]).toContain(
        `headRefName: "${localBranch}"`,
      );
    },
  );

  it("reads a known PR by URL only on the branch it was found on, and returns the branch and upstream", async () => {
    const workspacePath = await createManagedBaseTrackedWorkspace();
    const gh = await installFakeGh(sameRepository);
    const url = "https://github.com/acme/bb/pull/1236";
    const read = async (branchName: string) =>
      (
        await harness.experimental_call("views", {
          reads: [
            { path: workspacePath, known: { url, branchName }, refresh: true },
          ],
        })
      )[0]?.refs;
    const head = await runGit(["rev-parse", "HEAD"], { cwd: workspacePath });
    const refs = { oid: head.stdout.trim(), branchName: localBranch };

    await expect(read(localBranch)).resolves.toEqual(refs);
    await expect(read("bb/previous-branch")).resolves.toEqual(refs);

    const queries = await gh.readQueries();
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain(`resource(url: ${JSON.stringify(url)})`);
    expect(queries[1]).not.toContain("resource(url:");
    expect(queries[1]).toContain(`headRefName: "${localBranch}"`);
  });

  it("uses the local branch when a differently named remote aliases origin", async () => {
    const workspacePath = await createTrackedForkWorkspace(
      "git@github.com:acme/bb.git",
    );
    const gh = await installFakeGh(sameRepository);

    await expect(
      view({
        path: workspacePath,
        refresh: false,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 1236 },
    });

    const calls = await gh.readCalls();
    expect(calls).toHaveLength(1);
    expect((await gh.readQueries())[0]).toContain(
      `headRefName: "${localBranch}"`,
    );
  });

  it("qualifies the real tracked fork branch instead of the managed local branch", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    const gh = await installFakeGh(found);

    await expect(
      view({
        path: workspacePath,
        refresh: false,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 1236, headRefName: upstreamBranch },
    });

    const calls = await gh.readCalls();
    expect(calls).toHaveLength(1);
    expect((await gh.readQueries())[0]).toContain(
      `headRefName: "${upstreamBranch}"`,
    );
  });

  it("ignores other forks' PRs and settled default-branch PRs on the default branch", async () => {
    const workspacePath = await createManagedBaseTrackedWorkspace();
    await runGit(["checkout", "-q", "-b", "main"], { cwd: workspacePath });
    await installFakeGh(
      branchLookup([
        {
          number: 7,
          state: "OPEN",
          headRefName: "main",
          isCrossRepository: true,
          headRepositoryOwner: { login: "stranger" },
        },
        {
          number: 8,
          state: "MERGED",
          headRefName: "main",
          isCrossRepository: false,
          headRepositoryOwner: { login: "acme" },
        },
      ]),
    );

    await expect(
      view({
        path: workspacePath,
        refresh: true,
      }),
    ).resolves.toEqual({ outcome: "none" });
  });

  it("looks up a fork clone's branch in the upstream repository, as gh does", async () => {
    const workspacePath = await createRepository("bb-pr-fork-clone-");
    await runGit(["remote", "set-url", "origin", forkRemoteUrl], {
      cwd: workspacePath,
    });
    await runGit(["remote", "add", "upstream", "git@github.com:acme/bb.git"], {
      cwd: workspacePath,
    });
    await runGit(["update-ref", `refs/remotes/origin/${localBranch}`, "HEAD"], {
      cwd: workspacePath,
    });
    await runGit(
      ["branch", "--set-upstream-to", `origin/${localBranch}`, localBranch],
      { cwd: workspacePath },
    );
    const gh = await installFakeGh(found);

    await expect(
      view({
        path: workspacePath,
        refresh: true,
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 1236 },
    });
    const query = (await gh.readQueries())[0]!;
    expect(query).toContain('repository(owner: "acme", name: "bb")');
    expect(query).toContain(`headRefName: "${localBranch}"`);
  });

  it("uses the repository gh resolved for the workspace", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    await runGit(["config", `remote.${forkRemote}.gh-resolved`, "base"], {
      cwd: workspacePath,
    });
    const gh = await installFakeGh(sameRepository);

    await view({
      path: workspacePath,
      refresh: true,
    });
    expect((await gh.readQueries())[0]).toContain(
      'repository(owner: "fork-owner", name: "bb")',
    );
  });

  it("never passes an untrusted upstream URL to gh", async () => {
    const workspacePath = await createTrackedForkWorkspace(
      "https://httpbin.org/fork-owner/bb.git",
    );
    const gh = await installFakeGh(found);
    vi.stubEnv("GH_ENTERPRISE_TOKEN", "dummy-enterprise-token");

    await expect(
      view({
        path: workspacePath,
        refresh: false,
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      message:
        "Configured upstream remote host does not match the origin GitHub host",
    });
    expect(await gh.readCalls()).toEqual([]);
  });

  it("uses a changed remote URL on the next lookup", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    const gh = await installFakeGh(found);

    const first = await view({
      path: workspacePath,
      refresh: false,
    });
    await runGit(
      ["remote", "set-url", forkRemote, "git@github.com:other-owner/bb.git"],
      { cwd: workspacePath },
    );
    const second = await view({
      path: workspacePath,
      refresh: false,
    });
    expect(first).toMatchObject({
      outcome: "found",
      pullRequest: { number: 1236 },
    });
    expect(second).toMatchObject({
      outcome: "found",
      pullRequest: { number: 1237 },
    });
    expect(await gh.readCalls()).toHaveLength(2);
  });

  it.each([
    ["ready", { operation: "ready" }, ["pr", "ready"], []],
    ["draft", { operation: "draft" }, ["pr", "ready"], ["--undo"]],
    [
      "merge",
      { operation: "merge", method: "squash" },
      ["pr", "merge"],
      ["--squash"],
    ],
  ] as const)(
    "runs %s against the checked pull request URL",
    async (_label, action, command, flags) => {
      const workspacePath = await createTrackedForkWorkspace();
      const gh = await installFakeGh({});
      const url = "https://github.com/upstream-owner/bb/pull/1236";

      await expect(
        harness.experimental_call("act", { path: workspacePath, url, action }),
      ).resolves.toEqual({ ok: true });

      expect(await gh.readCalls()).toEqual([[...command, url, ...flags]]);
    },
  );

  it("returns none when gh genuinely finds no PR for the qualified upstream", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    await installFakeGh({
      "api graphql": {
        stdout: JSON.stringify({
          data: { p0: { pullRequests: { nodes: [] } } },
        }),
      },
    });

    await expect(
      view({
        path: workspacePath,
        refresh: false,
      }),
    ).resolves.toEqual({ outcome: "none" });
  });

  it("returns unavailable when gh is not installed", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    const binPath = await makeTempDir("bb-pr-upstream-no-gh-");
    const { stdout } = await execFileAsync(
      process.platform === "win32" ? "where.exe" : "which",
      ["git"],
      { encoding: "utf8" },
    );
    if (process.platform === "win32") {
      vi.stubEnv("PATH", path.dirname(stdout.trim().split(/\r?\n/)[0]!));
    } else {
      await fs.symlink(stdout.trim(), path.join(binPath, "git"));
      vi.stubEnv("PATH", binPath);
    }

    const command = hostToolchain.command.bind(hostToolchain);
    const missingGh = vi
      .spyOn(hostToolchain, "command")
      .mockImplementation((name, args, options) => {
        const launch = command(name, args, options);
        return name === "gh"
          ? { ...launch, command: path.join(binPath, "gh") }
          : launch;
      });
    try {
      await expect(
        view({
          path: workspacePath,
          refresh: false,
        }),
      ).resolves.toEqual({
        outcome: "unavailable",
        message: "GitHub CLI is not available",
      });
    } finally {
      missingGh.mockRestore();
    }
  });
});

describe("workspace state", () => {
  it("inspects the actual branch and upstream locally without running gh", async () => {
    const workspacePath = await createManagedBaseTrackedWorkspace();
    const gh = await installFakeGh({});
    const oid = (
      await runGit(["rev-parse", "HEAD"], { cwd: workspacePath })
    ).stdout.trim();
    await runGit(["commit", "--allow-empty", "-m", "Local only"], {
      cwd: workspacePath,
    });
    await expect(
      harness.experimental_call("upstream", { path: workspacePath }),
    ).resolves.toEqual({ oid, branchName: localBranch });
    expect(await gh.readCalls()).toEqual([]);
  });

  it("reports a missing workspace path as unavailable", async () => {
    const missing = path.join(await makeTempDir("bb-pr-missing-"), "gone");
    await expect(
      view({
        path: missing,
        refresh: false,
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      message: `Workspace path no longer exists: ${missing}`,
    });
  });

  it("finds no pull request from a detached workspace", async () => {
    const workspacePath = await createRepository("bb-pr-detached-");
    await runGit(["checkout", "--detach"], { cwd: workspacePath });
    const gh = await installFakeGh({});

    await expect(
      view({
        path: workspacePath,
        refresh: false,
      }),
    ).resolves.toEqual({ outcome: "none" });
    expect(await gh.readCalls()).toEqual([]);
  });
});
