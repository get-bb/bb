import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { experimental_createProcessLifeline } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type TestContext,
} from "vitest";
import { withGitRefMutationLock } from "bb-environment-provider-host/locks";
import { createWorktreeHostEntry } from "./host.js";

const execFileAsync = promisify(execFile);
let repositoryTemplate: string;
let clonedRepositoryTemplate: string;

beforeAll(async () => {
  repositoryTemplate = await mkdtemp(join(tmpdir(), "bb-worktree-template-"));
  await git(repositoryTemplate, "init", "--initial-branch=main");
  await writeFile(join(repositoryTemplate, "README.md"), "hello\n");
  await git(repositoryTemplate, "add", ".");
  await git(repositoryTemplate, "commit", "-m", "initial");
  clonedRepositoryTemplate = await mkdtemp(
    join(tmpdir(), "bb-worktree-clone-template-"),
  );
  const sourcePath = join(clonedRepositoryTemplate, "repo");
  const clone = join(clonedRepositoryTemplate, "clone");
  await cp(repositoryTemplate, sourcePath, { recursive: true });
  await git(sourcePath, "branch", "release");
  await git(clonedRepositoryTemplate, "clone", sourcePath, clone);
  await git(clone, "remote", "set-url", "origin", "../repo");
});

afterAll(async () => {
  if (clonedRepositoryTemplate) {
    await rm(clonedRepositoryTemplate, { recursive: true, force: true });
  }
  if (repositoryTemplate) {
    await rm(repositoryTemplate, { recursive: true, force: true });
  }
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "bb",
      GIT_AUTHOR_EMAIL: "bb@example.com",
      GIT_COMMITTER_NAME: "bb",
      GIT_COMMITTER_EMAIL: "bb@example.com",
    },
  });
  return result.stdout;
}

async function createSourceRepository(
  onTestFinished: TestContext["onTestFinished"],
  repositoryName = "repo",
): Promise<{
  root: string;
  sourcePath: string;
  dataDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-worktree-plugin-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, repositoryName);
  const dataDir = join(root, "plugin-data");
  await mkdir(sourcePath, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await cp(repositoryTemplate, sourcePath, { recursive: true });
  return { root, sourcePath, dataDir };
}

async function createClonedRepository(
  onTestFinished: TestContext["onTestFinished"],
): Promise<{
  root: string;
  sourcePath: string;
  clone: string;
  dataDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-worktree-plugin-clone-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await cp(clonedRepositoryTemplate, root, { recursive: true });
  const dataDir = join(root, "plugin-data");
  await mkdir(dataDir, { recursive: true });
  return {
    root,
    sourcePath: join(root, "repo"),
    clone: join(root, "clone"),
    dataDir,
  };
}

async function createDetachedSingleBranchRepository(
  onTestFinished: TestContext["onTestFinished"],
): Promise<{
  root: string;
  sourcePath: string;
  dataDir: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-worktree-plugin-detached-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const originPath = join(root, "origin");
  const sourcePath = join(root, "repo");
  const dataDir = join(root, "plugin-data");
  await cp(repositoryTemplate, originPath, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await git(originPath, "tag", "v1.0");
  await git(
    root,
    "clone",
    "--single-branch",
    "--branch",
    "v1.0",
    originPath,
    sourcePath,
  );
  return { root, sourcePath, dataDir };
}

function createHarness(dataDir: string) {
  return experimental_createHostEntryHarness(createWorktreeHostEntry(), {
    experimental_paths: { dataDir, tempDir: join(dataDir, "tmp") },
  });
}

function createInput(args: {
  operationId: string;
  sourcePath: string;
  pathKey: string;
  branchName: string;
}) {
  return {
    ...args,
    baseBranch: { kind: "default" as const },
    branchMode: "reset" as const,
  };
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return (await git(cwd, "branch", "--list", branch)).trim() !== "";
}

async function branchConfig(cwd: string, branch: string): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["config", "--get-regexp", `^branch\\.${branch.replaceAll("/", "\\/")}\\.`],
    { cwd },
  ).catch(() => ({ stdout: "" }));
  return result.stdout;
}

async function commitIn(cwd: string, file: string): Promise<string> {
  await writeFile(join(cwd, file), `${file}\n`);
  await git(cwd, "add", ".");
  await git(cwd, "commit", "-m", file);
  return (await git(cwd, "rev-parse", "HEAD")).trim();
}

function progressText(harness: ReturnType<typeof createHarness>): string {
  return harness
    .experimental_getSignals()
    .map((event) => event.payload.text)
    .join("\n");
}

describe.concurrent("worktree host entry", () => {
  it.for([
    "refs/worktree/saved",
    "refs/bisect/saved",
    "refs/rewritten/saved",
    "MERGE_HEAD",
  ])(
    "keeps clean worktrees with local Git state: %s",
    async (state, { onTestFinished }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const harness = createHarness(dataDir);
      onTestFinished(() => harness.experimental_dispose());
      const created = await harness.experimental_call(
        "create",
        createInput({
          operationId: "create-state",
          sourcePath,
          pathKey: "saved-state",
          branchName: "bb/saved-state",
        }),
      );
      if (created.status !== "created") throw new Error(created.message);
      const savedCommit = (
        await git(
          created.path,
          "commit-tree",
          "HEAD^{tree}",
          "-p",
          "HEAD",
          "-m",
          "saved",
        )
      ).trim();
      if (state === "MERGE_HEAD") {
        await git(created.path, "merge", "--no-ff", "--no-commit", savedCommit);
      } else {
        await git(created.path, "update-ref", state, savedCommit);
      }
      const gitDir = (
        await git(created.path, "rev-parse", "--absolute-git-dir")
      ).trim();
      expect(await git(created.path, "status", "--porcelain")).toBe("");
      expect((await git(created.path, "rev-parse", state)).trim()).toBe(
        savedCommit,
      );
      expect(
        (await git(sourcePath, "rev-parse", "bb/saved-state")).trim(),
      ).toBe((await git(created.path, "rev-parse", "HEAD")).trim());
      const ownedBranch = {
        name: "bb/saved-state",
        repositoryPath: sourcePath,
        baseBranch: created.baseBranch,
      };
      const result = await harness.experimental_call("remove", {
        operationId: "remove-state",
        pathKey: "saved-state",
        path: created.path,
        ownedBranch,
        folderBranches: [],
      });
      expect({
        status: result.status,
        worktreeExists: existsSync(created.path),
        metadataExists: existsSync(gitDir),
      }).toEqual({
        status: "failed",
        worktreeExists: true,
        metadataExists: true,
      });
      expect((await git(created.path, "rev-parse", state)).trim()).toBe(
        savedCommit,
      );
      expect(await branchExists(sourcePath, "bb/saved-state")).toBe(true);
      if (state === "MERGE_HEAD") {
        await git(created.path, "merge", "--abort");
      } else {
        await git(created.path, "update-ref", "-d", state);
      }
      expect(
        await harness.experimental_call("remove", {
          operationId: "remove-resolved-state",
          pathKey: "saved-state",
          path: created.path,
          ownedBranch,
          folderBranches: [],
        }),
      ).toEqual({ status: "removed" });
      expect(existsSync(created.path)).toBe(false);
      expect(await branchExists(sourcePath, "bb/saved-state")).toBe(false);
    },
  );

  it("removes a worktree after a conflicted rebase finishes", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const harness = createHarness(dataDir);
    onTestFinished(() => harness.experimental_dispose());
    const created = await harness.experimental_call(
      "create",
      createInput({
        operationId: "create-rebased",
        sourcePath,
        pathKey: "rebased",
        branchName: "bb/rebased",
      }),
    );
    if (created.status !== "created") throw new Error(created.message);
    await writeFile(join(created.path, "conflict.txt"), "branch\n");
    await git(created.path, "add", ".");
    await git(created.path, "commit", "-m", "branch");
    const upstream = (await git(created.path, "rev-parse", "HEAD~1")).trim();
    await git(created.path, "checkout", "-q", "--detach", upstream);
    await writeFile(join(created.path, "conflict.txt"), "upstream\n");
    await git(created.path, "add", ".");
    await git(created.path, "commit", "-m", "upstream");
    const onto = (await git(created.path, "rev-parse", "HEAD")).trim();
    await git(created.path, "checkout", "-q", "bb/rebased");
    await expect(git(created.path, "rebase", onto)).rejects.toThrow();
    await writeFile(join(created.path, "conflict.txt"), "resolved\n");
    await git(created.path, "add", ".");
    await git(created.path, "-c", "core.editor=true", "rebase", "--continue");
    const gitDir = (
      await git(created.path, "rev-parse", "--absolute-git-dir")
    ).trim();
    expect(existsSync(join(gitDir, "REBASE_HEAD"))).toBe(true);

    expect(
      await harness.experimental_call("remove", {
        operationId: "remove-rebased",
        pathKey: "rebased",
        path: created.path,
        ownedBranch: {
          name: "bb/rebased",
          repositoryPath: sourcePath,
          baseBranch: created.baseBranch,
        },
        folderBranches: [],
      }),
    ).toEqual({ status: "removed" });
    expect(existsSync(created.path)).toBe(false);
  });

  it.for(["main", "release", "origin/main", "refs/heads/main"])(
    "resolves and fetches a stale named base %s",
    async (base, { onTestFinished }) => {
      const { sourcePath, clone, dataDir } =
        await createClonedRepository(onTestFinished);
      const oldHead = (await git(clone, "rev-parse", "HEAD")).trim();
      await git(clone, "branch", "release", "origin/release");
      await writeFile(join(sourcePath, "README.md"), "remote advance\n");
      await git(sourcePath, "commit", "-am", "advance remote");
      await git(sourcePath, "branch", "-f", "release", "HEAD");
      const remoteHead = (await git(sourcePath, "rev-parse", "HEAD")).trim();
      const result = await createHarness(dataDir).experimental_call("create", {
        ...createInput({
          operationId: "stale-base",
          sourcePath: clone,
          pathKey: "stale-base",
          branchName: "bb/child",
        }),
        baseBranch: { kind: "named", name: base },
      });
      expect(result.status).toBe("created");
      if (result.status !== "created") throw new Error(result.message);
      expect((await git(result.path, "rev-parse", "HEAD")).trim()).toBe(
        base.startsWith("refs/heads/") ? oldHead : remoteHead,
      );
      expect((await git(clone, "rev-parse", "main")).trim()).toBe(oldHead);
    },
  );

  it.for([
    ["ahead", "main"],
    ["diverged", "main"],
    ["ahead", "release"],
    ["diverged", "release"],
    ["ahead", "origin/main"],
    ["diverged", "refs/heads/main"],
    ["ahead", "default"],
    ["diverged", "default"],
  ])(
    "preserves local commits for %s with base %s",
    async ([relation, base], { onTestFinished }) => {
      const { sourcePath, clone, dataDir } =
        await createClonedRepository(onTestFinished);
      await writeFile(join(clone, "local.txt"), "local work\n");
      await git(clone, "add", ".");
      await git(clone, "commit", "-m", "local work");
      await git(clone, "branch", "release");
      const localHead = (await git(clone, "rev-parse", "HEAD")).trim();
      if (relation === "diverged") {
        await writeFile(join(sourcePath, "remote.txt"), "remote work\n");
        await git(sourcePath, "add", ".");
        await git(sourcePath, "commit", "-m", "remote work");
        await git(sourcePath, "branch", "-f", "release", "HEAD");
        await git(clone, "fetch", "origin");
      }
      const remoteHead = (await git(sourcePath, "rev-parse", "HEAD")).trim();
      const harness = createHarness(dataDir);
      try {
        const result = await harness.experimental_call("create", {
          ...createInput({
            operationId: "local-work",
            sourcePath: clone,
            pathKey: "local-work",
            branchName: "bb/child",
          }),
          baseBranch:
            base === "default"
              ? { kind: "default" }
              : { kind: "named", name: base },
        });
        expect(result.status).toBe("created");
        if (result.status !== "created") throw new Error(result.message);
        expect((await git(result.path, "rev-parse", "HEAD")).trim()).toBe(
          base === "origin/main" ? remoteHead : localHead,
        );
      } finally {
        await harness.experimental_dispose();
      }
    },
  );

  it.for([
    ["equal", "main"],
    ["behind", "main"],
    ["equal", "default"],
    ["behind", "default"],
    ["remote-only", "release"],
  ])(
    "uses the last fetched remote when the fetch fails for %s with base %s",
    async ([relation, base], { onTestFinished }) => {
      const { root, sourcePath, clone, dataDir } =
        await createClonedRepository(onTestFinished);
      const localHead = (await git(clone, "rev-parse", "HEAD")).trim();
      if (relation === "behind" || relation === "remote-only") {
        await writeFile(join(sourcePath, "README.md"), "remote advance\n");
        await git(sourcePath, "commit", "-am", "advance remote");
        await git(sourcePath, "branch", "-f", "release", "HEAD");
        await git(clone, "fetch", "origin");
      }
      const lastFetched = base === "release" ? "origin/release" : "origin/main";
      const lastFetchedHead = (
        await git(clone, "rev-parse", lastFetched)
      ).trim();
      await git(clone, "remote", "set-url", "origin", join(root, "missing"));
      const harness = createHarness(dataDir);
      try {
        const result = await harness.experimental_call("create", {
          ...createInput({
            operationId: "offline",
            sourcePath: clone,
            pathKey: "offline",
            branchName: "bb/offline",
          }),
          baseBranch:
            base === "default"
              ? { kind: "default" }
              : { kind: "named", name: base },
        });
        expect(result).toMatchObject({
          status: "created",
          baseBranch: lastFetched,
        });
        if (result.status !== "created") throw new Error(result.message);
        expect((await git(result.path, "rev-parse", "HEAD")).trim()).toBe(
          lastFetchedHead,
        );
        expect((await git(clone, "rev-parse", "main")).trim()).toBe(localHead);
        const progress = progressText(harness);
        expect(progress).toContain(`Failed to fetch ${lastFetched}`);
        expect(progress).toContain(
          `Using the last fetched ${lastFetched} (${lastFetchedHead.slice(0, 7)}`,
        );
      } finally {
        await harness.experimental_dispose();
      }
    },
  );

  it.for(["main", "default"])(
    "keeps a local base that is ahead without fetching for base %s",
    async (base, { onTestFinished }) => {
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const clone = join(root, "clone");
      await git(root, "clone", sourcePath, clone);
      await writeFile(join(clone, "local.txt"), "local work\n");
      await git(clone, "add", ".");
      await git(clone, "commit", "-m", "local work");
      const localHead = (await git(clone, "rev-parse", "HEAD")).trim();
      await git(clone, "remote", "set-url", "origin", join(root, "missing"));
      const harness = createHarness(dataDir);
      try {
        const result = await harness.experimental_call("create", {
          ...createInput({
            operationId: "offline-ahead",
            sourcePath: clone,
            pathKey: "offline-ahead",
            branchName: "bb/offline-ahead",
          }),
          baseBranch:
            base === "default"
              ? { kind: "default" }
              : { kind: "named", name: base },
        });
        expect(result).toMatchObject({ status: "created", baseBranch: "main" });
        if (result.status !== "created") throw new Error(result.message);
        expect((await git(result.path, "rev-parse", "HEAD")).trim()).toBe(
          localHead,
        );
        expect(progressText(harness)).not.toMatch(/fetch/iu);
      } finally {
        await harness.experimental_dispose();
      }
    },
  );

  it("fails when an explicit remote base cannot be fetched", async ({
    onTestFinished,
  }) => {
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const clone = join(root, "clone");
    await git(root, "clone", sourcePath, clone);
    await git(clone, "remote", "set-url", "origin", join(root, "missing"));
    const harness = createHarness(dataDir);
    try {
      const result = await harness.experimental_call("create", {
        ...createInput({
          operationId: "offline-explicit",
          sourcePath: clone,
          pathKey: "offline-explicit",
          branchName: "bb/offline-explicit",
        }),
        baseBranch: { kind: "named", name: "origin/main" },
      });
      expect(result).toMatchObject({
        status: "failed",
        message: expect.stringContaining("git fetch"),
      });
      expect(progressText(harness)).not.toContain("Using the last fetched");
      expect(
        existsSync(join(dataDir, "worktrees", "offline-explicit", "clone")),
      ).toBe(false);
    } finally {
      await harness.experimental_dispose();
    }
  });

  it.skipIf(process.platform === "win32").sequential(
    "cancels a create whose base fetch is still running",
    async ({ onTestFinished }) => {
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const clone = join(root, "clone");
      await git(root, "clone", sourcePath, clone);
      const sshPidPath = join(root, "ssh.pid");
      const sshPath = join(root, "hanging-ssh");
      await writeFile(
        sshPath,
        `#!/bin/sh\necho $$ > "${sshPidPath}"\nexec sleep 30\n`,
        { mode: 0o755 },
      );
      await git(clone, "config", "core.sshCommand", sshPath);
      await git(clone, "remote", "set-url", "origin", "ssh://bb.invalid/repo");
      const harness = createHarness(dataDir);
      const controller = new AbortController();
      const created = harness
        .experimental_call(
          "create",
          {
            ...createInput({
              operationId: "cancelled-fetch",
              sourcePath: clone,
              pathKey: "cancelled-fetch",
              branchName: "bb/cancelled-fetch",
            }),
            baseBranch: { kind: "named", name: "main" },
          },
          { signal: controller.signal },
        )
        .catch((error: unknown) => error);
      await expect
        .poll(() => existsSync(sshPidPath), { timeout: 10_000 })
        .toBe(true);
      controller.abort();
      expect(await created).toBeInstanceOf(Error);
      expect(progressText(harness)).not.toContain("Using the last fetched");
      expect(
        existsSync(join(dataDir, "worktrees", "cancelled-fetch", "clone")),
      ).toBe(false);
      await harness.experimental_dispose();
    },
  );

  it.for([
    { existingBranch: false, branchMode: "reset" },
    { existingBranch: false, branchMode: "reuse-existing" },
    { existingBranch: true, branchMode: "reuse-existing" },
    { existingBranch: true, branchMode: "reset" },
  ] as const)(
    "creates with a locked config (existing=$existingBranch, mode=$branchMode)",
    async ({ existingBranch, branchMode }, { onTestFinished }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      await git(sourcePath, "remote", "add", "origin", sourcePath);
      await git(sourcePath, "fetch", "origin");
      await git(sourcePath, "config", "branch.autoSetupMerge", "always");
      await git(sourcePath, "config", "core.autocrlf", "true");
      const branchName = "bb/config-lock";
      if (existingBranch) {
        await git(
          sourcePath,
          "update-ref",
          "refs/remotes/origin/published",
          "HEAD",
        );
        await git(
          sourcePath,
          "branch",
          "--track",
          branchName,
          "origin/published",
        );
      }
      const configPath = join(sourcePath, ".git", "config");
      const originalConfig = await readFile(configPath, "utf8");
      const lockPath = `${configPath}.lock`;
      await writeFile(lockPath, "another Git writer\n");
      const harness = createHarness(dataDir);
      try {
        const result = await harness.experimental_call("create", {
          ...createInput({
            operationId: "config-lock",
            sourcePath,
            pathKey: "config-lock",
            branchName,
          }),
          branchMode,
          baseBranch: { kind: "named", name: "origin/main" },
        });
        expect(result.status).toBe("created");
        if (result.status !== "created") throw new Error(result.message);
        expect(
          (await readFile(join(result.path, "README.md"), "utf8")).replace(
            /\r\n/gu,
            "\n",
          ),
        ).toBe("hello\n");
        expect(await git(result.path, "rev-parse", "HEAD")).toBe(
          await git(sourcePath, "rev-parse", "origin/main"),
        );
        expect(
          (
            await git(
              result.path,
              "for-each-ref",
              "--format=%(upstream:short)",
              `refs/heads/${branchName}`,
            )
          ).trim(),
        ).toBe(existingBranch ? "origin/published" : "");
        expect(await readFile(lockPath, "utf8")).toBe("another Git writer\n");
        expect(await readFile(configPath, "utf8")).toBe(originalConfig);
      } finally {
        await harness.experimental_dispose();
      }
    },
  );

  it("resolves adoption paths with trailing slashes and symlink aliases", async ({
    onTestFinished,
  }) => {
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const worktreePath = join(root, "feature");
    await git(sourcePath, "worktree", "add", "-b", "feature", worktreePath);
    const canonicalPath = await realpath(worktreePath);
    const aliasPath = join(root, "feature-alias");
    await symlink(worktreePath, aliasPath, "junction");
    const harness = createHarness(dataDir);

    for (const path of [canonicalPath, `${canonicalPath}/`, aliasPath]) {
      expect(
        await harness.experimental_call("resolveExistingWorktree", {
          sourcePath,
          path,
        }),
      ).toEqual({ status: "resolved", path: canonicalPath, branch: "feature" });
    }
  });

  it("refuses adoption aliases of the main checkout and managed worktrees", async ({
    onTestFinished,
  }) => {
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const worktreePath = join(dataDir, "worktrees", "managed");
    await git(sourcePath, "worktree", "add", "-b", "managed", worktreePath);
    const dataAlias = join(root, "data-alias");
    await symlink(dataDir, dataAlias, "junction");
    const harness = createHarness(dataAlias);

    expect(
      await harness.experimental_call("listWorktrees", { sourcePath }),
    ).toEqual({ worktrees: [] });
    for (const [index, target] of [sourcePath, worktreePath].entries()) {
      const aliasPath = join(root, `alias-${index}`);
      await symlink(target, aliasPath, "junction");
      expect(
        await harness.experimental_call("resolveExistingWorktree", {
          sourcePath,
          path: aliasPath,
        }),
      ).toMatchObject({ status: "failed" });
    }
  });

  it("preserves adoption failures for missing and prunable worktrees", async ({
    onTestFinished,
  }) => {
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const worktreePath = join(root, "feature");
    await git(sourcePath, "worktree", "add", "-b", "feature", worktreePath);
    const canonicalPath = await realpath(worktreePath);
    await rm(worktreePath, { recursive: true });
    const harness = createHarness(dataDir);

    expect(
      await harness.experimental_call("resolveExistingWorktree", {
        sourcePath,
        path: `${canonicalPath}/`,
      }),
    ).toMatchObject({
      status: "failed",
      message: expect.stringContaining("prunable worktree"),
    });
    expect(
      await harness.experimental_call("resolveExistingWorktree", {
        sourcePath,
        path: join(root, "missing"),
      }),
    ).toMatchObject({
      status: "failed",
      message: expect.stringContaining("not a worktree"),
    });
  });

  it("resolves the default label from the same refs used for creation", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const harness = createHarness(dataDir);
    expect(
      await harness.experimental_call("defaultBaseBranch", { sourcePath }),
    ).toEqual({ branch: "main" });
    await git(sourcePath, "update-ref", "refs/remotes/origin/main", "HEAD");
    await git(
      sourcePath,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/main",
    );
    expect(
      await harness.experimental_call("defaultBaseBranch", { sourcePath }),
    ).toEqual({ branch: "origin/main" });
    await writeFile(join(sourcePath, "README.md"), "ahead");
    await git(sourcePath, "commit", "-am", "local ahead");
    expect(
      await harness.experimental_call("defaultBaseBranch", { sourcePath }),
    ).toEqual({ branch: "main" });
  });

  it.for([
    ["spaces", "Repo With Space", "Repo-With-Space-7373994537587106"],
    ["CJK", "資料庫", "repo-1b2c8c90d27707c4"],
    ["NFC", "café", "cafe-850f7dc43910ff89"],
    ["NFD", "cafe\u0301", "cafe-81ef060bcd98adc7"],
    ["punctuation only", "!!!", "repo-e84c538e7fe25073"],
  ])(
    "creates and discovers cleanup paths for repository names with %s",
    async ([_label, repositoryName, expectedLeaf], { onTestFinished }) => {
      const { sourcePath, dataDir } = await createSourceRepository(
        onTestFinished,
        repositoryName,
      );
      const harness = createHarness(dataDir);
      const pathKey = "special-name";
      const result = await harness.experimental_call(
        "create",
        createInput({
          operationId: "create-special",
          sourcePath,
          pathKey,
          branchName: "bb/special-name",
        }),
      );
      expect(result).toMatchObject({
        status: "created",
        path: join(dataDir, "worktrees", pathKey, expectedLeaf),
      });
      if (result.status !== "created") throw new Error(result.message);
      expect(existsSync(join(result.path, "README.md"))).toBe(true);
      expect(
        await harness.experimental_call("remove", {
          operationId: "remove-special",
          pathKey,
          path: null,
          ownedBranch: null,
          folderBranches: [],
        }),
      ).toEqual({ status: "removed" });
      expect(existsSync(join(dataDir, "worktrees", pathKey))).toBe(false);
      await harness.experimental_dispose();
    },
  );

  it("creates a bounded worktree path for a long repository name", async ({
    skip,
    onTestFinished,
  }) => {
    skip(
      process.platform === "win32",
      "Windows cannot start a process whose working directory is longer than MAX_PATH",
    );
    const repositoryName = "repository".repeat(24);
    const { sourcePath, dataDir } = await createSourceRepository(
      onTestFinished,
      repositoryName,
    );
    const harness = createHarness(dataDir);
    const result = await harness.experimental_call(
      "create",
      createInput({
        operationId: "long-name",
        sourcePath,
        pathKey: "long-name",
        branchName: "bb/long-name",
      }),
    );
    expect(result.status).toBe("created");
    if (result.status !== "created") throw new Error(result.message);
    expect(Buffer.byteLength(basename(result.path), "utf8")).toBe(200);
    expect(basename(result.path)).toMatch(/-[a-f0-9]{16}$/u);
    expect(existsSync(join(result.path, "README.md"))).toBe(true);
    await harness.experimental_dispose();
  });

  it("provisions the same specially named repository concurrently", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } = await createSourceRepository(
      onTestFinished,
      "Concurrent Repo",
    );
    const harness = createHarness(dataDir);
    const [first, second] = await Promise.all([
      harness.experimental_call(
        "create",
        createInput({
          operationId: "concurrent-first",
          sourcePath,
          pathKey: "concurrent-1",
          branchName: "bb/concurrent-1",
        }),
      ),
      harness.experimental_call(
        "create",
        createInput({
          operationId: "concurrent-second",
          sourcePath,
          pathKey: "concurrent-2",
          branchName: "bb/concurrent-2",
        }),
      ),
    ]);
    expect(first.status).toBe("created");
    expect(second.status).toBe("created");
    if (first.status !== "created") throw new Error(first.message);
    if (second.status !== "created") throw new Error(second.message);
    expect(first.path).not.toBe(second.path);
    expect(basename(first.path)).toBe(basename(second.path));
    expect(existsSync(join(first.path, "README.md"))).toBe(true);
    expect(existsSync(join(second.path, "README.md"))).toBe(true);
    await harness.experimental_dispose();
  });

  it.skipIf(process.platform === "win32").sequential(
    "settles a cancelled create promptly when Git's children are still running",
    async ({ onTestFinished }) => {
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const lifeline = await experimental_createProcessLifeline();
      onTestFinished(() => lifeline.close());
      const hookPath = join(sourcePath, ".git", "hooks", "post-checkout");
      await writeFile(
        hookPath,
        `#!/bin/sh\nexec "${process.execPath}" -e '${lifeline.holdSource("hook")}setInterval(() => {}, 1000);'\n`,
        { mode: 0o755 },
      );
      const harness = createHarness(dataDir);
      const controller = new AbortController();
      const created = harness
        .experimental_call(
          "create",
          createInput({
            operationId: "cancelled-create",
            sourcePath,
            pathKey: "cancelled",
            branchName: "bb/cancelled",
          }),
          { signal: controller.signal },
        )
        .catch((error: unknown) => error);
      const [hook] = await lifeline.waitForHolders(1);
      const abortedAt = performance.now();
      controller.abort();
      expect(await created).toBeInstanceOf(Error);
      expect(performance.now() - abortedAt).toBeLessThan(3_000);
      await hook?.exited;
      expect(hook?.alive()).toBe(false);
      await harness.experimental_dispose();
    },
  );

  it("creates a worktree on a named base under the path-key directory", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    await git(sourcePath, "branch", "release");
    await git(sourcePath, "checkout", "release");
    await writeFile(join(sourcePath, "release.txt"), "release\n");
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "release only");
    await git(sourcePath, "checkout", "main");
    const harness = createHarness(dataDir);
    const result = await harness.experimental_call("create", {
      operationId: "named",
      sourcePath,
      pathKey: "thr_1",
      branchName: "bb/named-thr_1",
      baseBranch: { kind: "named", name: "release" },
      branchMode: "reset",
    });
    expect(result).toMatchObject({
      status: "created",
      path: join(dataDir, "worktrees", "thr_1", "repo"),
      baseBranch: "release",
    });
    if (result.status !== "created") throw new Error(result.message);
    expect(existsSync(join(result.path, "release.txt"))).toBe(true);
    expect(
      (await git(result.path, "rev-parse", "--abbrev-ref", "HEAD")).trim(),
    ).toBe("bb/named-thr_1");
    await harness.experimental_dispose();
  });

  it("creates on an explicit base from a detached single-branch checkout", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createDetachedSingleBranchRepository(onTestFinished);
    const harness = createHarness(dataDir);
    const result = await harness.experimental_call("create", {
      operationId: "detached",
      sourcePath,
      pathKey: "thr_detached",
      branchName: "bb/detached-thr",
      baseBranch: { kind: "named", name: "v1.0" },
      branchMode: "reset",
    });
    expect(result).toMatchObject({
      status: "created",
      path: join(dataDir, "worktrees", "thr_detached", "repo"),
      baseBranch: "v1.0",
    });
    if (result.status !== "created") throw new Error(result.message);
    expect(existsSync(join(result.path, "README.md"))).toBe(true);
    await harness.experimental_dispose();
  });

  it("re-runs create with the same path key without replacing a valid worktree", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } = await createSourceRepository(
      onTestFinished,
      "Restartable Repo",
    );
    const input = createInput({
      operationId: "first",
      sourcePath,
      pathKey: "same-path-key",
      branchName: "bb/restart",
    });
    const firstHarness = createHarness(dataDir);
    const first = await firstHarness.experimental_call("create", input);
    if (first.status !== "created") throw new Error(first.message);
    await writeFile(join(first.path, "survives.txt"), "kept\n");
    await firstHarness.experimental_dispose();

    const restartedHarness = createHarness(dataDir);
    const resumed = await restartedHarness.experimental_call("create", {
      ...input,
      operationId: "resumed",
    });
    expect(resumed).toEqual(first);
    expect(existsSync(join(first.path, "survives.txt"))).toBe(true);
    await restartedHarness.experimental_dispose();
  });

  it("creates a detached worktree, names its branch later, and resumes either step", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } = await createSourceRepository(
      onTestFinished,
      "Named Later",
    );
    const input = {
      ...createInput({
        operationId: "detached",
        sourcePath,
        pathKey: "thr_later",
        branchName: "unused",
      }),
      branchName: null,
    };
    const harness = createHarness(dataDir);
    const created = await harness.experimental_call("create", input);
    if (created.status !== "created") throw new Error(created.message);
    expect(created.ownsBranch).toBe(false);
    expect(
      (await git(created.path, "rev-parse", "--abbrev-ref", "HEAD")).trim(),
    ).toBe("HEAD");
    await writeFile(join(created.path, "setup-output.txt"), "kept\n");
    expect(await harness.experimental_call("create", input)).toEqual(created);

    const name = {
      operationId: "name",
      sourcePath,
      path: created.path,
      branchName: "bb/named-later-thr_later",
    };
    expect(await harness.experimental_call("nameBranch", name)).toEqual({
      status: "named",
    });
    expect(await harness.experimental_call("nameBranch", name)).toEqual({
      status: "named",
    });
    expect(
      (await git(created.path, "rev-parse", "--abbrev-ref", "HEAD")).trim(),
    ).toBe("bb/named-later-thr_later");
    expect((await git(created.path, "rev-parse", "HEAD")).trim()).toBe(
      (await git(sourcePath, "rev-parse", "main")).trim(),
    );
    expect(await branchConfig(sourcePath, "bb/named-later-thr_later")).toBe("");
    expect(await harness.experimental_call("create", input)).toEqual(created);
    expect(existsSync(join(created.path, "setup-output.txt"))).toBe(true);
    await harness.experimental_dispose();
  });

  it("completes a recovered worktree without running core setup", async ({
    onTestFinished,
  }) => {
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const setupMarker = join(root, "setup.marker");
    await writeFile(
      join(sourcePath, ".bb-env-setup.sh"),
      `#!/usr/bin/env bash\necho resumed > ${setupMarker}\n`,
    );
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "add setup script");
    const pathKey = "interrupted";
    const branchName = "bb/interrupted";
    const targetPath = join(dataDir, "worktrees", pathKey, "repo");
    await mkdir(join(dataDir, "worktrees", pathKey), { recursive: true });
    await git(
      sourcePath,
      "worktree",
      "add",
      "-B",
      branchName,
      targetPath,
      "main",
    );

    const harness = createHarness(dataDir);
    const resumed = await harness.experimental_call(
      "create",
      createInput({
        operationId: "resume-interrupted",
        sourcePath,
        pathKey,
        branchName,
      }),
    );

    expect(resumed).toMatchObject({ status: "created", path: targetPath });
    expect(existsSync(setupMarker)).toBe(false);
    expect(progressText(harness)).not.toContain("Running .bb-env-setup.sh");
    await harness.experimental_dispose();
  });

  it("replaces an invalid target before recreating the expected branch", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const harness = createHarness(dataDir);
    const input = createInput({
      operationId: "first",
      sourcePath,
      pathKey: "replace",
      branchName: "bb/expected",
    });
    const first = await harness.experimental_call("create", input);
    if (first.status !== "created") throw new Error(first.message);
    await git(first.path, "checkout", "-b", "wrong-branch");
    const replaced = await harness.experimental_call("create", {
      ...input,
      operationId: "retry",
    });
    expect(replaced.status).toBe("created");
    expect(
      (await git(first.path, "rev-parse", "--abbrev-ref", "HEAD")).trim(),
    ).toBe("bb/expected");
    await harness.experimental_dispose();
  });

  it("leaves setup execution to core", async ({ onTestFinished }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    await writeFile(
      join(sourcePath, ".bb-env-setup.sh"),
      "#!/usr/bin/env bash\necho setup-line-one\necho setup-line-two\n",
    );
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "add setup script");
    const harness = createHarness(dataDir);
    expect(
      await harness.experimental_call(
        "create",
        createInput({
          operationId: "setup",
          sourcePath,
          pathKey: "thr_3",
          branchName: "bb/setup-thr_3",
        }),
      ),
    ).toMatchObject({ status: "created" });
    expect(progressText(harness)).not.toContain("Running .bb-env-setup.sh");
    expect(progressText(harness)).not.toContain("setup-line-one");
    expect(progressText(harness)).not.toContain("setup-line-two");
    expect(
      harness
        .experimental_getSignals()
        .every((event) => event.payload.operationId === "setup"),
    ).toBe(true);
    await harness.experimental_dispose();
  });

  it("leaves a dirty earlier attempt alone when it holds the branch", async ({
    onTestFinished,
  }) => {
    const { sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    const harness = createHarness(dataDir);
    const first = await harness.experimental_call(
      "create",
      createInput({
        operationId: "first",
        sourcePath,
        pathKey: "thr_7",
        branchName: "bb/dirty-thr_7",
      }),
    );
    if (first.status !== "created") throw new Error(first.message);
    await writeFile(join(first.path, "notes.txt"), "work in progress\n");
    const retry = await harness.experimental_call(
      "create",
      createInput({
        operationId: "retry",
        sourcePath,
        pathKey: "thr_7-2",
        branchName: "bb/dirty-thr_7",
      }),
    );
    expect(retry).toMatchObject({
      status: "failed",
      message: expect.stringContaining("uncommitted changes"),
    });
    expect(existsSync(join(first.path, "notes.txt"))).toBe(true);
    await harness.experimental_dispose();
  });

  it.sequential("leaves teardown to core, kills workspace processes, and prunes the path-key parent", async ({
    skip,
    onTestFinished,
  }) => {
    skip(
      process.platform === "win32",
      "killProcessesWithCwdUnder does not enumerate process working directories on Windows",
    );
    const { root, sourcePath, dataDir } =
      await createSourceRepository(onTestFinished);
    await writeFile(
      join(sourcePath, ".bb-env-teardown.sh"),
      `#!/usr/bin/env bash\necho teardown-ran > ${join(root, "teardown.marker")}\necho tearing-down\n`,
    );
    await git(sourcePath, "add", ".");
    await git(sourcePath, "commit", "-m", "add teardown script");
    const harness = createHarness(dataDir);
    const created = await harness.experimental_call(
      "create",
      createInput({
        operationId: "create",
        sourcePath,
        pathKey: "thr_6",
        branchName: "bb/teardown-thr_6",
      }),
    );
    if (created.status !== "created") throw new Error(created.message);
    const lingering = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 300_000)"],
      {
        cwd: created.path,
        detached: true,
        stdio: "ignore",
      },
    );
    lingering.unref();
    const removed = await harness.experimental_call("remove", {
      operationId: "remove",
      pathKey: "thr_6",
      path: created.path,
      ownedBranch: null,
      folderBranches: [],
    });
    if (lingering.exitCode === null && lingering.signalCode === null) {
      await once(lingering, "exit");
    }
    expect(removed).toEqual({ status: "removed" });
    expect(progressText(harness)).not.toContain("tearing-down");
    expect(existsSync(join(root, "teardown.marker"))).toBe(false);
    expect(existsSync(created.path)).toBe(false);
    expect(await readdir(join(dataDir, "worktrees"))).toEqual([]);
    await harness.experimental_dispose();
  });
  describe("owned branch cleanup", () => {
    async function createOwned(
      sourcePath: string,
      dataDir: string,
      branchName: string,
      storedBaseBranch?: string,
    ) {
      const harness = createHarness(dataDir);
      const created = await harness.experimental_call(
        "create",
        createInput({
          operationId: "create",
          sourcePath,
          pathKey: branchName.replaceAll("/", "-"),
          branchName,
        }),
      );
      if (created.status !== "created") throw new Error(created.message);
      expect(created.ownsBranch).toBe(true);
      const remove = () =>
        harness.experimental_call("remove", {
          operationId: "remove",
          pathKey: branchName.replaceAll("/", "-"),
          path: created.path,
          ownedBranch: {
            name: branchName,
            repositoryPath: sourcePath,
            baseBranch: storedBaseBranch ?? created.baseBranch,
          },
          folderBranches: [],
        });
      return { harness, path: created.path, remove };
    }

    it("deletes the branch it created and its config when nothing else would be lost", async ({
      onTestFinished,
    }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const owned = await createOwned(sourcePath, dataDir, "bb/clean-thr_1");
      await git(
        sourcePath,
        "config",
        "branch.bb/clean-thr_1.merge",
        "refs/heads/main",
      );
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(existsSync(owned.path)).toBe(false);
      expect(await branchExists(sourcePath, "bb/clean-thr_1")).toBe(false);
      expect(await branchConfig(sourcePath, "bb/clean-thr_1")).toBe("");
      expect(progressText(owned.harness)).toContain(
        "Deleted branch bb/clean-thr_1",
      );
      await owned.harness.experimental_dispose();
    });

    it("deletes a branch whose commits are already on a remote", async ({
      onTestFinished,
    }) => {
      const { clone, dataDir } = await createClonedRepository(onTestFinished);
      const owned = await createOwned(clone, dataDir, "bb/pushed-thr_2");
      await commitIn(owned.path, "pushed.txt");
      await git(clone, "push", "origin", "bb/pushed-thr_2");
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(await branchExists(clone, "bb/pushed-thr_2")).toBe(false);
      await owned.harness.experimental_dispose();
    });

    it("keeps a branch with commits that exist nowhere else and reports why", async ({
      onTestFinished,
    }) => {
      const { clone, dataDir } = await createClonedRepository(onTestFinished);
      const owned = await createOwned(clone, dataDir, "bb/unpushed-thr_3");
      const head = await commitIn(owned.path, "local-only.txt");
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(existsSync(owned.path)).toBe(false);
      expect(
        (await git(clone, "rev-parse", "refs/heads/bb/unpushed-thr_3")).trim(),
      ).toBe(head);
      expect(progressText(owned.harness)).toContain(
        "Kept branch bb/unpushed-thr_3 because it has commits that are on no remote or tag, not in its base, and not squash-merged into its base",
      );
      await owned.harness.experimental_dispose();
    });

    it("keeps a branch whose commits survive only on another local branch", async ({
      onTestFinished,
    }) => {
      const { clone, dataDir } = await createClonedRepository(onTestFinished);
      const owned = await createOwned(clone, dataDir, "bb/copied-thr_9");
      const head = await commitIn(owned.path, "copied.txt");
      await git(clone, "branch", "my-copy", head);
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(
        (await git(clone, "rev-parse", "refs/heads/bb/copied-thr_9")).trim(),
      ).toBe(head);
      await owned.harness.experimental_dispose();
    });

    it("deletes the branch it created when a post-checkout hook fails the create", async ({
      onTestFinished,
    }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      await writeFile(
        join(sourcePath, ".git", "hooks", "post-checkout"),
        "#!/bin/sh\nexit 1\n",
        { mode: 0o755 },
      );
      const harness = createHarness(dataDir);
      onTestFinished(() => harness.experimental_dispose());
      const created = await harness.experimental_call(
        "create",
        createInput({
          operationId: "create",
          sourcePath,
          pathKey: "thr_10",
          branchName: "bb/failed-thr_10",
        }),
      );
      expect(created).toMatchObject({ status: "failed" });
      expect(
        await git(sourcePath, "worktree", "list", "--porcelain"),
      ).not.toContain("bb/failed-thr_10");
      expect(await branchExists(sourcePath, "bb/failed-thr_10")).toBe(false);
      expect(progressText(harness)).toContain(
        "Deleted branch bb/failed-thr_10",
      );
    });

    it.for([
      ["deletes", "squash-merged", true],
      ["keeps", "squash-merged then extended", false],
      ["keeps", "partly squash-merged", false],
    ] as const)(
      "%s a branch that was %s into its base",
      async ([, scenario, deleted], { onTestFinished }) => {
        const { sourcePath, clone, dataDir } =
          await createClonedRepository(onTestFinished);
        const branch = "bb/squash-thr_9";
        const owned = await createOwned(clone, dataDir, branch);
        await commitIn(owned.path, "one.txt");
        await commitIn(owned.path, "two.txt");
        await git(clone, "push", "origin", branch);
        await commitIn(sourcePath, "unrelated.txt");
        if (scenario === "partly squash-merged") {
          await git(sourcePath, "checkout", `${branch}~1`, "--", "one.txt");
        } else {
          await git(sourcePath, "merge", "--squash", branch);
        }
        await git(sourcePath, "commit", "-m", "Squash (#1)");
        await git(sourcePath, "branch", "-D", branch);
        await git(clone, "fetch", "--prune", "origin");
        if (scenario === "squash-merged then extended") {
          await commitIn(owned.path, "three.txt");
        }
        expect(await owned.remove()).toEqual({ status: "removed" });
        expect(await branchExists(clone, branch)).toBe(!deleted);
        await owned.harness.experimental_dispose();
      },
    );

    it("deletes a squash-merged branch whose stored bare base trails origin", async ({
      onTestFinished,
    }) => {
      const { sourcePath, clone, dataDir } =
        await createClonedRepository(onTestFinished);
      const branch = "bb/squash-local-base-thr_9";
      const owned = await createOwned(clone, dataDir, branch, "main");
      await commitIn(owned.path, "one.txt");
      await git(clone, "push", "origin", branch);
      await git(sourcePath, "merge", "--squash", branch);
      await git(sourcePath, "commit", "-m", "Squash (#2)");
      await git(sourcePath, "branch", "-D", branch);
      await git(clone, "fetch", "--prune", "origin");
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(await branchExists(clone, branch)).toBe(false);
      await owned.harness.experimental_dispose();
    });

    it("keeps its branch when another checkout has it and never touches the user's branch", async ({
      onTestFinished,
    }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const owned = await createOwned(sourcePath, dataDir, "bb/shared-thr_4");
      await git(owned.path, "switch", "-c", "my-feature");
      await git(sourcePath, "switch", "bb/shared-thr_4");
      expect(await owned.remove()).toEqual({ status: "removed" });
      expect(await branchExists(sourcePath, "bb/shared-thr_4")).toBe(true);
      expect(await branchExists(sourcePath, "my-feature")).toBe(true);
      expect(progressText(owned.harness)).toContain(
        "Kept branch bb/shared-thr_4 because another worktree has it checked out",
      );
      await owned.harness.experimental_dispose();
    });

    it("leaves branches alone when removal carries no owned branch", async ({
      onTestFinished,
    }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const harness = createHarness(dataDir);
      const created = await harness.experimental_call(
        "create",
        createInput({
          operationId: "create",
          sourcePath,
          pathKey: "legacy",
          branchName: "bb/legacy-thr_5",
        }),
      );
      if (created.status !== "created") throw new Error(created.message);
      expect(
        await harness.experimental_call("remove", {
          operationId: "remove",
          pathKey: "legacy",
          path: created.path,
          ownedBranch: null,
          folderBranches: [],
        }),
      ).toEqual({ status: "removed" });
      expect(await branchExists(sourcePath, "bb/legacy-thr_5")).toBe(true);
      await harness.experimental_dispose();
    });

    it("still reports removal when the repository has moved away", async ({
      onTestFinished,
    }) => {
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const harness = createHarness(dataDir);
      expect(
        await harness.experimental_call("remove", {
          operationId: "remove",
          pathKey: "gone",
          path: join(dataDir, "worktrees", "gone", "repo"),
          ownedBranch: {
            name: "bb/gone-thr_6",
            repositoryPath: join(root, "moved"),
            baseBranch: "main",
          },
          folderBranches: [],
        }),
      ).toEqual({ status: "removed" });
      expect(await branchExists(sourcePath, "main")).toBe(true);
      await harness.experimental_dispose();
    });

    it("restores a deleted pushed branch from its remote and owns it again", async ({
      onTestFinished,
    }) => {
      const { clone, dataDir } = await createClonedRepository(onTestFinished);
      const owned = await createOwned(clone, dataDir, "bb/restore-thr_7");
      const pushedHead = await commitIn(owned.path, "restored.txt");
      await git(clone, "push", "origin", "bb/restore-thr_7");
      await owned.remove();
      expect(await branchExists(clone, "bb/restore-thr_7")).toBe(false);
      const restored = await owned.harness.experimental_call("create", {
        ...createInput({
          operationId: "restore",
          sourcePath: clone,
          pathKey: "restore-2",
          branchName: "bb/restore-thr_7",
        }),
        branchMode: "reuse-existing",
      });
      if (restored.status !== "created") throw new Error(restored.message);
      expect(restored.ownsBranch).toBe(true);
      expect((await git(restored.path, "rev-parse", "HEAD")).trim()).toBe(
        pushedHead,
      );
      expect(
        (
          await git(restored.path, "rev-parse", "--abbrev-ref", "@{upstream}")
        ).trim(),
      ).toBe("origin/bb/restore-thr_7");
      await owned.harness.experimental_dispose();
    });

    it("owns a branch it kept again when a restore reuses it", async ({
      onTestFinished,
    }) => {
      const { clone, dataDir } = await createClonedRepository(onTestFinished);
      const owned = await createOwned(clone, dataDir, "bb/kept-thr_8");
      const head = await commitIn(owned.path, "kept.txt");
      await owned.remove();
      expect(
        (
          await git(clone, "config", "--get", "branch.bb/kept-thr_8.bbOwned")
        ).trim(),
      ).toBe("true");
      const restored = await owned.harness.experimental_call("create", {
        ...createInput({
          operationId: "restore",
          sourcePath: clone,
          pathKey: "kept-2",
          branchName: "bb/kept-thr_8",
        }),
        branchMode: "reuse-existing",
      });
      if (restored.status !== "created") throw new Error(restored.message);
      expect(restored.ownsBranch).toBe(true);
      expect((await git(restored.path, "rev-parse", "HEAD")).trim()).toBe(head);
      await owned.harness.experimental_dispose();
    });

    it("does not claim a branch it never kept when a restore reuses it", async ({
      onTestFinished,
    }) => {
      const { sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      await git(sourcePath, "branch", "my-feature");
      const harness = createHarness(dataDir);
      const restored = await harness.experimental_call("create", {
        ...createInput({
          operationId: "restore",
          sourcePath,
          pathKey: "user-branch",
          branchName: "my-feature",
        }),
        branchMode: "reuse-existing",
      });
      if (restored.status !== "created") throw new Error(restored.message);
      expect(restored.ownsBranch).toBe(false);
      await harness.experimental_dispose();
    });
  });
});

describe.concurrent("folder worktrees", () => {
  async function createProject(onTestFinished: TestContext["onTestFinished"]) {
    const { root, sourcePath, dataDir } = await createSourceRepository(
      onTestFinished,
      "app",
    );
    const folder = async (name: string) => {
      const folderPath = join(root, "folders", name);
      await mkdir(folderPath, { recursive: true });
      await cp(repositoryTemplate, folderPath, { recursive: true });
      return folderPath;
    };
    const harness = createHarness(dataDir);
    onTestFinished(() => harness.experimental_dispose());
    const main = await harness.experimental_call("create", {
      ...createInput({
        operationId: "create",
        sourcePath,
        pathKey: "thr_folders",
        branchName: "unused",
      }),
      branchName: null,
    });
    if (main.status !== "created") throw new Error(main.message);
    return { root, sourcePath, dataDir, harness, main, folder };
  }

  it("makes each folder's worktree next to the main one on the same branch, and removal deletes every worktree and branch", async ({
    onTestFinished,
  }) => {
    const project = await createProject(onTestFinished);
    const api = await project.folder("api");
    const sameName = await project.folder("app");
    const created = await project.harness.experimental_call("createFolders", {
      operationId: "folders",
      sourcePath: project.sourcePath,
      path: project.main.path,
      folders: [api, sameName],
      branchName: null,
      branchMode: "reset",
    });
    if (created.status !== "created") throw new Error(created.message);
    const environmentRoot = join(project.dataDir, "worktrees", "thr_folders");
    expect(created.folders.map((folder) => folder.path)).toEqual([
      join(environmentRoot, "api"),
      expect.stringMatching(/\/app-[0-9a-f]{16}$/u),
    ]);
    expect(
      created.folders.map((folder) => folder.path.startsWith(environmentRoot)),
    ).toEqual([true, true]);

    const branchName = "bb/folders-thr_folders";
    for (const [sourcePath, path] of [
      [project.sourcePath, project.main.path],
      ...created.folders.map((folder) => [folder.sourcePath, folder.path]),
    ] as const) {
      expect(
        await project.harness.experimental_call("nameBranch", {
          operationId: `name-${path}`,
          sourcePath,
          path,
          branchName,
        }),
      ).toEqual({ status: "named" });
    }
    for (const folder of created.folders) {
      expect(
        (await git(folder.path, "rev-parse", "--abbrev-ref", "HEAD")).trim(),
      ).toBe(branchName);
      expect(await branchExists(folder.sourcePath, branchName)).toBe(true);
    }

    expect(
      await project.harness.experimental_call("remove", {
        operationId: "remove",
        pathKey: "thr_folders",
        path: project.main.path,
        ownedBranch: {
          name: branchName,
          repositoryPath: project.sourcePath,
          baseBranch: project.main.baseBranch,
        },
        folderBranches: created.folders.map((folder) => ({
          name: branchName,
          repositoryPath: folder.sourcePath,
          baseBranch: folder.baseBranch,
        })),
      }),
    ).toEqual({ status: "removed" });
    expect(existsSync(environmentRoot)).toBe(false);
    for (const repository of [project.sourcePath, api, sameName]) {
      expect(await branchExists(repository, branchName)).toBe(false);
      expect(
        await git(repository, "worktree", "list", "--porcelain"),
      ).not.toContain(environmentRoot);
    }
  });

  it("refuses a folder that is not a repository's top folder or repeats a repository", async ({
    onTestFinished,
  }) => {
    const project = await createProject(onTestFinished);
    const api = await project.folder("api");
    const plain = join(project.root, "folders", "notes");
    await mkdir(join(api, "nested"), { recursive: true });
    await mkdir(plain, { recursive: true });
    expect(
      await project.harness.experimental_call("listFolderRepositories", {
        paths: [api, join(api, "nested"), plain],
      }),
    ).toEqual({ paths: [api] });
    for (const [folders, message] of [
      [[join(api, "nested")], "not the top folder of a Git repository"],
      [[project.sourcePath], `same Git repository as ${project.sourcePath}`],
    ] as const) {
      expect(
        await project.harness.experimental_call("createFolders", {
          operationId: "folders",
          sourcePath: project.sourcePath,
          path: project.main.path,
          folders: [...folders],
          branchName: null,
          branchMode: "reset",
        }),
      ).toEqual({
        status: "failed",
        message: expect.stringContaining(message),
      });
    }
    expect(
      await readdir(join(project.dataDir, "worktrees", "thr_folders")),
    ).toEqual(["app", "app.completed"]);
  });

  it("removes the folder worktrees it made when another folder's worktree fails", async ({
    onTestFinished,
  }) => {
    const project = await createProject(onTestFinished);
    const api = await project.folder("api");
    const web = await project.folder("web");
    await writeFile(
      join(web, ".git", "hooks", "post-checkout"),
      "#!/bin/sh\nexit 1\n",
      {
        mode: 0o755,
      },
    );
    const created = await project.harness.experimental_call("createFolders", {
      operationId: "folders",
      sourcePath: project.sourcePath,
      path: project.main.path,
      folders: [api, web],
      branchName: "bb/failed-thr_folders",
      branchMode: "reset",
    });
    expect(created).toEqual({
      status: "failed",
      message: expect.stringContaining(`Could not make a worktree of ${web}`),
    });
    expect(
      await readdir(join(project.dataDir, "worktrees", "thr_folders")),
    ).toEqual(["app", "app.completed"]);
    for (const repository of [api, web]) {
      expect(await branchExists(repository, "bb/failed-thr_folders")).toBe(
        false,
      );
    }
  });
});

describe("warm worktree handoff", () => {
  async function warmWorktree(onTestFinished: TestContext["onTestFinished"]) {
    const { sourcePath, clone, dataDir } =
      await createClonedRepository(onTestFinished);
    const harness = createHarness(dataDir);
    onTestFinished(() => harness.experimental_dispose());
    const created = await harness.experimental_call(
      "create",
      createInput({
        operationId: "create-warm",
        sourcePath: clone,
        pathKey: "env_warm-1",
        branchName: "bb/env_warm",
      }),
    );
    if (created.status !== "created") throw new Error(created.message);
    const head = (await git(created.path, "rev-parse", "HEAD")).trim();
    const check = (baseCommit = head) => ({
      sourcePath: clone,
      path: created.path,
      placeholder: "bb/env_warm",
      baseBranch: "origin/main",
      baseCommit,
    });
    const name = (toBranch: string) => ({
      path: created.path,
      fromBranch: "bb/env_warm",
      toBranch,
    });
    return {
      sourcePath,
      clone,
      harness,
      path: created.path,
      head,
      check,
      name,
    };
  }

  it("checks a warm worktree without touching its branch, then renames the placeholder in place", async ({
    onTestFinished,
  }) => {
    const { clone, harness, path, head, check, name } =
      await warmWorktree(onTestFinished);
    expect(await harness.experimental_call("checkPoolMember", check())).toEqual(
      { status: "usable", head },
    );
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "bb/env_warm",
    );
    await harness.experimental_call(
      "nameHandedOffBranch",
      name("bb/fix-login-thr_1"),
    );
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "bb/fix-login-thr_1",
    );
    expect((await git(path, "rev-parse", "HEAD")).trim()).toBe(head);
    expect(await branchExists(clone, "bb/env_warm")).toBe(false);
    expect(await readFile(`${path}.completed`, "utf8")).toBe(
      "bb/fix-login-thr_1\n",
    );
  });

  it("fetches a remote base commit that has not been fetched yet, accepts a warm worktree behind it, and moves it forward", async ({
    onTestFinished,
  }) => {
    const { sourcePath, clone, harness, path, head, check } =
      await warmWorktree(onTestFinished);
    const upstream = await commitIn(sourcePath, "upstream.txt");
    expect(
      await harness.experimental_call("readRemoteBase", { sourcePath: clone }),
    ).toEqual({ ref: "origin/main", commit: upstream, offline: false });
    expect(
      (await git(clone, "rev-parse", "refs/remotes/origin/main")).trim(),
    ).toBe(head);
    expect(
      await harness.experimental_call("checkPoolMember", check(upstream)),
    ).toEqual({ status: "usable", head });
    await harness.experimental_call("fastForward", { path, commit: upstream });
    expect((await git(path, "rev-parse", "HEAD")).trim()).toBe(upstream);
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "bb/env_warm",
    );
    expect((await readFile(join(path, "upstream.txt"), "utf8")).trimEnd()).toBe(
      "upstream.txt",
    );
    expect(await git(path, "status", "--porcelain")).toBe("");
    expect(
      await harness.experimental_call("refreshPoolBase", {
        sourcePath: clone,
        memberPaths: [path],
      }),
    ).toEqual({
      status: "refreshed",
      ref: "origin/main",
      commit: upstream,
      members: [{ path, head: upstream, branch: "bb/env_warm", onBase: true }],
    });
  });

  it("reports a project folder that is gone or is not a git repository", async ({
    onTestFinished,
  }) => {
    const { clone, harness, path } = await warmWorktree(onTestFinished);
    expect(
      await harness.experimental_call("refreshPoolBase", {
        sourcePath: `${clone}-missing`,
        memberPaths: [path],
      }),
    ).toEqual({ status: "no-repository" });
    const plain = `${clone}-plain`;
    await mkdir(plain);
    expect(
      await harness.experimental_call("refreshPoolBase", {
        sourcePath: plain,
        memberPaths: [],
      }),
    ).toEqual({ status: "no-repository" });
  });

  it("refuses a warm worktree that is not on the base after the base was rewritten", async ({
    onTestFinished,
  }) => {
    const { sourcePath, clone, harness, path, check } =
      await warmWorktree(onTestFinished);
    await git(sourcePath, "checkout", "--orphan", "rewritten");
    const rewritten = await commitIn(sourcePath, "rewritten.txt");
    await git(sourcePath, "branch", "-f", "main", rewritten);
    await git(sourcePath, "checkout", "main");
    const refreshed = await harness.experimental_call("refreshPoolBase", {
      sourcePath: clone,
      memberPaths: [path],
    });
    if (refreshed.status !== "refreshed") throw new Error("Expected a refresh");
    expect(refreshed.commit).toBe(rewritten);
    expect(refreshed.members[0]?.onBase).toBe(false);
    expect(
      await harness.experimental_call("checkPoolMember", check(rewritten)),
    ).toEqual({ status: "refused", reason: "it is not on origin/main" });
  });

  it("falls back to the last fetched base when the remote cannot be reached", async ({
    onTestFinished,
  }) => {
    const { clone, harness, head } = await warmWorktree(onTestFinished);
    await git(clone, "remote", "set-url", "origin", `${clone}-missing`);
    expect(
      await harness.experimental_call("readRemoteBase", { sourcePath: clone }),
    ).toEqual({ ref: "origin/main", commit: head, offline: true });
  });

  it("refuses a warm worktree that sits on another branch while its placeholder still exists", async ({
    onTestFinished,
  }) => {
    const { harness, path, check } = await warmWorktree(onTestFinished);
    await git(path, "switch", "-c", "someone-elses");
    expect(await harness.experimental_call("checkPoolMember", check())).toEqual(
      { status: "refused", reason: "it was used on someone-elses" },
    );
  });

  it("removes the branch a handoff renamed to, even when the recorded branch is still the placeholder", async ({
    onTestFinished,
  }) => {
    const { clone, harness, path, name } = await warmWorktree(onTestFinished);
    await harness.experimental_call(
      "nameHandedOffBranch",
      name("bb/interrupted-thr_4"),
    );
    const removed = await harness.experimental_call("remove", {
      operationId: "remove-interrupted",
      pathKey: "env_warm-1",
      path,
      ownedBranch: {
        name: "bb/env_warm",
        repositoryPath: clone,
        baseBranch: "origin/main",
      },
      folderBranches: [],
    });
    expect(removed).toEqual({ status: "removed" });
    expect(await branchExists(clone, "bb/interrupted-thr_4")).toBe(false);
    expect(await branchExists(clone, "bb/env_warm")).toBe(false);
  });

  it("restores an unused checkout that left its placeholder, and keeps it", async ({
    onTestFinished,
  }) => {
    const { clone, harness, path } = await warmWorktree(onTestFinished);
    await git(path, "branch", "-m", "bb/env_warm", "bb/orphan-thr_5");
    expect(
      await harness.experimental_call("restorePoolMember", {
        sourcePath: clone,
        path,
        placeholder: "bb/env_warm",
      }),
    ).toEqual({ status: "restored" });
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "bb/env_warm",
    );
    expect(await branchExists(clone, "bb/orphan-thr_5")).toBe(false);
  });

  it("puts the placeholder back on a checkout that was used, so removal owns that branch", async ({
    onTestFinished,
  }) => {
    const { clone, harness, path } = await warmWorktree(onTestFinished);
    await git(path, "branch", "-m", "bb/env_warm", "bb/used-thr_6");
    await commitIn(path, "work.txt");
    expect(
      await harness.experimental_call("restorePoolMember", {
        sourcePath: clone,
        path,
        placeholder: "bb/env_warm",
      }),
    ).toEqual({ status: "used", branch: "bb/used-thr_6" });
    expect(await branchExists(clone, "bb/used-thr_6")).toBe(false);
    expect((await git(path, "branch", "--show-current")).trim()).toBe(
      "bb/env_warm",
    );
  });

  it("answers busy quickly instead of waiting behind a git ref update", async ({
    onTestFinished,
  }) => {
    const { harness, path, check } = await warmWorktree(onTestFinished);
    const commonDir = (
      await git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    ).trim();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withGitRefMutationLock(commonDir, () => held);
    onTestFinished(async () => {
      release();
      await holding;
    });
    const started = Date.now();
    expect(await harness.experimental_call("checkPoolMember", check())).toEqual(
      { status: "busy" },
    );
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
