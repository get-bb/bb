import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nodeFsReader } from "./node-fs.js";
import { createNodeGitRunner } from "./run.js";
import { createGitGraphService, type GitGraphService } from "./service.js";

const gitAvailable = await new Promise<boolean>((resolve) => {
  execFile("git", ["--version"], { timeout: 5_000 }, (error, stdout) => {
    resolve(error === null && String(stdout).includes("git version"));
  });
});

const runGit = createNodeGitRunner("git");

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit(["-C", cwd, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}`,
    );
  }
  return result.stdout;
}

describe.skipIf(!gitAvailable)("git-graph service against real git", () => {
  let projectRoot: string;
  let service: GitGraphService;

  beforeAll(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "bb git graph "));
    service = createGitGraphService({ runGit, fs: nodeFsReader });

    await git(projectRoot, ["init", "-b", "main"]);
    await git(projectRoot, ["config", "user.email", "test@example.com"]);
    await git(projectRoot, ["config", "user.name", "Test User"]);
    await writeFile(path.join(projectRoot, "README.md"), "hello\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "Initial commit"]);

    await git(projectRoot, ["checkout", "-b", "feature"]);
    await writeFile(path.join(projectRoot, "feature.txt"), "feature\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "Add feature"]);

    await git(projectRoot, ["checkout", "main"]);
    await writeFile(path.join(projectRoot, "README.md"), "hello world\n");
    await git(projectRoot, ["add", "."]);
    await git(projectRoot, ["commit", "-m", "Update main"]);

    await git(projectRoot, ["merge", "feature", "-m", "Merge feature"]);
    await git(projectRoot, ["tag", "v1.0"]);
    await git(projectRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const nested = path.join(projectRoot, "Nested Ünïcode Tools");
    await mkdir(nested, { recursive: true });
    await git(nested, ["init", "-b", "main"]);
    await git(nested, ["config", "user.email", "test@example.com"]);
    await git(nested, ["config", "user.name", "Test User"]);
    await writeFile(path.join(nested, "notes.txt"), "nested\n");
    await git(nested, ["add", "."]);
    await git(nested, ["commit", "-m", "Nested repo commit"]);

    const hidden = path.join(projectRoot, "node_modules", "hidden-repo");
    await mkdir(hidden, { recursive: true });
    await git(hidden, ["init"]);

    const fresh = path.join(projectRoot, "fresh-repo");
    await mkdir(fresh, { recursive: true });
    await git(fresh, ["init", "-b", "main"]);
  }, 120_000);

  afterAll(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("discovers the root repo, nested unicode repo, and empty repo while skipping node_modules", async () => {
    const scan = await service.scanProjectRepos(projectRoot);
    expect(scan.scanError).toBeNull();
    expect(scan.scanTruncated).toBe(false);
    const relPaths = scan.repos.map((repo) => repo.relPath);
    expect(relPaths).toContain("");
    expect(relPaths).toContain("Nested Ünïcode Tools");
    expect(relPaths).toContain("fresh-repo");
    expect(relPaths).not.toContain("node_modules/hidden-repo");
    const root = scan.repos.find((repo) => repo.relPath === "");
    expect(root?.position).toBe("root");
    expect(root?.head?.branch).toBe("main");
    expect(root?.empty).toBe(false);
    const fresh = scan.repos.find((repo) => repo.relPath === "fresh-repo");
    expect(fresh?.empty).toBe(true);
  }, 60_000);

  it("returns history with merge parents and refs", async () => {
    const page = await service.history(projectRoot, {
      offset: 0,
      limit: 20,
      includeRemotes: true,
      refs: [],
    });
    expect(page.empty).toBe(false);
    expect(page.commits.length).toBeGreaterThanOrEqual(4);
    const merge = page.commits[0];
    expect(merge?.subject).toBe("Merge feature");
    expect(merge?.parents).toHaveLength(2);
    const headRefs = merge?.refs ?? [];
    expect(headRefs.find((ref) => ref.name === "main")?.isHead).toBe(true);
    expect(headRefs.some((ref) => ref.name === "origin/main")).toBe(true);
    expect(
      headRefs.some((ref) => ref.name === "v1.0" && ref.kind === "tag"),
    ).toBe(true);
  }, 60_000);

  it("pages history by offset and filters by message", async () => {
    const firstPage = await service.history(projectRoot, {
      offset: 0,
      limit: 2,
      includeRemotes: false,
      refs: [],
    });
    const secondPage = await service.history(projectRoot, {
      offset: 2,
      limit: 2,
      includeRemotes: false,
      refs: [],
    });
    expect(firstPage.commits).toHaveLength(2);
    expect(secondPage.commits.length).toBeGreaterThanOrEqual(1);
    expect(firstPage.commits[0]?.hash).not.toBe(secondPage.commits[0]?.hash);

    const filtered = await service.history(projectRoot, {
      offset: 0,
      limit: 20,
      query: "feature",
      includeRemotes: false,
      refs: [],
    });
    expect(filtered.commits.length).toBeGreaterThanOrEqual(2);
    expect(
      filtered.commits.every((commit) =>
        commit.subject.toLowerCase().includes("feature"),
      ),
    ).toBe(true);
  }, 60_000);

  it("returns merge commit details with files and patch", async () => {
    const page = await service.history(projectRoot, {
      offset: 0,
      limit: 1,
      includeRemotes: false,
      refs: [],
    });
    const mergeHash = page.commits[0]!.hash;
    const detail = await service.commitDetail(projectRoot, mergeHash);
    expect(detail.commit.isMerge).toBe(true);
    expect(detail.commit.parents).toHaveLength(2);
    expect(detail.commit.message).toContain("Merge feature");
    expect(detail.filesNote).toBe("Compared against the first parent.");
    expect(detail.files.some((file) => file.path === "feature.txt")).toBe(true);

    const patch = await service.filePatch(
      projectRoot,
      mergeHash,
      "feature.txt",
    );
    expect(patch.truncated).toBe(false);
    expect(patch.patch).toContain("@@");
    expect(patch.patch).toContain("+feature");
  }, 60_000);

  it("returns root commit details with the full patch against the empty tree", async () => {
    const page = await service.history(projectRoot, {
      offset: 0,
      limit: 20,
      includeRemotes: true,
      refs: [],
    });
    const root = page.commits.find(
      (commit) => commit.subject === "Initial commit",
    );
    expect(root).toBeDefined();
    const detail = await service.commitDetail(projectRoot, root!.hash);
    expect(detail.commit.isRoot).toBe(true);
    expect(detail.commit.parents).toHaveLength(0);
    expect(detail.files.some((file) => file.path === "README.md")).toBe(true);
    const patch = await service.filePatch(projectRoot, root!.hash, "README.md");
    expect(patch.patch).toContain("+hello");
  }, 60_000);

  it("scopes history to a selected local branch", async () => {
    const page = await service.history(projectRoot, {
      offset: 0,
      limit: 20,
      includeRemotes: false,
      refs: ["refs/heads/feature"],
    });
    expect(page.commits.length).toBeGreaterThan(0);
    const subjects = page.commits.map((commit) => commit.subject);
    expect(subjects).toContain("Add feature");
    expect(subjects).toContain("Initial commit");
    expect(subjects).not.toContain("Update main");
    expect(subjects).not.toContain("Merge feature");
  }, 60_000);

  it("hides remote-only commits and remote pills until remotes are included", async () => {
    await git(projectRoot, ["checkout", "--orphan", "solo-parent"]);
    await writeFile(path.join(projectRoot, "solo.txt"), "solo\n");
    await git(projectRoot, ["add", "solo.txt"]);
    await git(projectRoot, ["commit", "-m", "Solo remote commit"]);
    await git(projectRoot, ["update-ref", "refs/remotes/origin/solo", "HEAD"]);
    await git(projectRoot, ["checkout", "main"]);
    await git(projectRoot, ["branch", "-D", "solo-parent"]);

    const localsOnly = await service.history(projectRoot, {
      offset: 0,
      limit: 100,
      includeRemotes: false,
      refs: [],
    });
    expect(
      localsOnly.commits.some((c) => c.subject === "Solo remote commit"),
    ).toBe(false);
    const merge = localsOnly.commits[0];
    expect(merge?.subject).toBe("Merge feature");
    expect(merge?.refs.some((ref) => ref.kind === "remote")).toBe(false);

    const withRemotes = await service.history(projectRoot, {
      offset: 0,
      limit: 100,
      includeRemotes: true,
      refs: [],
    });
    expect(
      withRemotes.commits.some((c) => c.subject === "Solo remote commit"),
    ).toBe(true);
    const mergeWithRemotes = withRemotes.commits.find(
      (c) => c.subject === "Merge feature",
    );
    expect(
      mergeWithRemotes?.refs.some(
        (ref) => ref.name === "origin/main" && ref.kind === "remote",
      ),
    ).toBe(true);
  }, 120_000);

  it("unions the history of several selected branches", async () => {
    const page = await service.history(projectRoot, {
      offset: 0,
      limit: 100,
      includeRemotes: true,
      refs: ["refs/heads/feature", "refs/remotes/origin/solo"],
    });
    const subjects = page.commits.map((commit) => commit.subject);
    expect(subjects).toContain("Add feature");
    expect(subjects).toContain("Solo remote commit");
    expect(subjects).toContain("Initial commit");
    expect(subjects).not.toContain("Merge feature");
    expect(subjects).not.toContain("Update main");
  }, 60_000);

  it("lists selectable branches without remote HEAD aliases", async () => {
    await git(projectRoot, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    ]);
    const status = await service.repoStatus(projectRoot);
    expect(status.error).toBeNull();
    const names = status.branches.map((branch) => branch.fullName);
    expect(names).toContain("refs/heads/main");
    expect(names).toContain("refs/heads/feature");
    expect(names).toContain("refs/remotes/origin/main");
    expect(names).not.toContain("refs/remotes/origin/HEAD");
    const head = status.branches.find((branch) => branch.isHead);
    expect(head?.fullName).toBe("refs/heads/main");
    const firstRemote = status.branches.find((b) => b.isRemote);
    const lastLocal = [...status.branches].reverse().find((b) => !b.isRemote);
    expect(status.branches.indexOf(firstRemote!)).toBeGreaterThan(
      status.branches.indexOf(lastLocal!),
    );
  }, 60_000);

  it("counts dirty working copy entries", async () => {
    await writeFile(path.join(projectRoot, "README.md"), "dirty\n");
    await writeFile(path.join(projectRoot, "untracked.txt"), "new\n");
    await git(projectRoot, ["add", "untracked.txt"]);
    const status = await service.repoStatus(projectRoot);
    expect(status.error).toBeNull();
    expect(status.dirty).not.toBeNull();
    expect(status.dirty?.staged).toBeGreaterThanOrEqual(1);
    expect(status.dirty?.unstaged).toBeGreaterThanOrEqual(1);
    expect(status.dirty?.total).toBeGreaterThanOrEqual(2);
    expect(status.branchCount).toBe(2);
    expect(status.tagCount).toBe(1);
    expect(status.remoteRefCount).toBe(2);
  }, 60_000);

  it("returns an empty page for a repository without commits", async () => {
    const page = await service.history(path.join(projectRoot, "fresh-repo"), {
      offset: 0,
      limit: 10,
      includeRemotes: false,
      refs: [],
    });
    expect(page).toEqual({ commits: [], empty: true });
  }, 60_000);
});
