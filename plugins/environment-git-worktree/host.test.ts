import { execFile, spawn } from "node:child_process";
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
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type TestContext,
} from "vitest";
import { createWorktreeHostEntry } from "./host.js";

const execFileAsync = promisify(execFile);
let repositoryTemplate: string;

beforeAll(async () => {
  repositoryTemplate = await mkdtemp(join(tmpdir(), "bb-worktree-template-"));
  await git(repositoryTemplate, "init", "--initial-branch=main");
  await writeFile(join(repositoryTemplate, "README.md"), "hello\n");
  await git(repositoryTemplate, "add", ".");
  await git(repositoryTemplate, "commit", "-m", "initial");
});

afterAll(async () => {
  if (repositoryTemplate) {
    await rm(repositoryTemplate, { recursive: true, force: true });
  }
});

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
  await mkdir(originPath, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await git(originPath, "init", "--initial-branch=main");
  await writeFile(join(originPath, "README.md"), "hello\n");
  await git(originPath, "add", ".");
  await git(originPath, "commit", "-m", "initial");
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

function progressText(harness: ReturnType<typeof createHarness>): string {
  return harness
    .experimental_getSignals()
    .map((event) => event.payload.text)
    .join("\n");
}

describe.concurrent("worktree host entry", () => {
  it.for(["main", "release", "origin/main", "refs/heads/main"])(
    "resolves and fetches a stale named base %s",
    async (base, { onTestFinished }) => {
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const clone = join(root, "clone");
      await git(sourcePath, "branch", "release");
      await git(root, "clone", sourcePath, clone);
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
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const clone = join(root, "clone");
      await git(sourcePath, "branch", "release");
      await git(root, "clone", sourcePath, clone);
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
      const { root, sourcePath, dataDir } =
        await createSourceRepository(onTestFinished);
      const clone = join(root, "clone");
      await git(sourcePath, "branch", "release");
      await git(root, "clone", sourcePath, clone);
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
      const hookPidPath = join(root, "hook.pid");
      const hookPath = join(sourcePath, ".git", "hooks", "post-checkout");
      await writeFile(
        hookPath,
        `#!/bin/sh\necho $$ > "${hookPidPath}"\nexec sleep 30\n`,
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
      await expect
        .poll(() => existsSync(hookPidPath), { timeout: 10_000 })
        .toBe(true);
      const hookPid = Number((await readFile(hookPidPath, "utf8")).trim());
      const abortedAt = performance.now();
      controller.abort();
      expect(await created).toBeInstanceOf(Error);
      expect(performance.now() - abortedAt).toBeLessThan(3_000);
      await expect.poll(() => isPidAlive(hookPid)).toBe(false);
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
    });
    const lingeringAlive = isPidAlive(lingering.pid ?? 0);
    lingering.kill("SIGKILL");
    expect(removed).toEqual({ status: "removed" });
    expect(lingeringAlive).toBe(false);
    expect(progressText(harness)).not.toContain("tearing-down");
    expect(existsSync(join(root, "teardown.marker"))).toBe(false);
    expect(existsSync(created.path)).toBe(false);
    expect(await readdir(join(dataDir, "worktrees"))).toEqual([]);
    await harness.experimental_dispose();
  });
});
