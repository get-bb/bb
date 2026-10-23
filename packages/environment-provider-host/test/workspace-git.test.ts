import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectGitRepo,
  detectGitRepoKind,
  parsePorcelainV2StatusZ,
  readDefaultBranchRefs,
  runGit,
} from "../src/workspace-git.js";
import { fetchRemoteBranches } from "../src/branch-options.js";

const tempDirs: string[] = [];

async function initReadGitBlobRepo() {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-read-git-blob-"),
  );
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.mkdir(path.join(repoPath, "docs"));
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await fs.writeFile(path.join(repoPath, "docs", "index.md"), "docs\n", "utf8");
  await fs.writeFile(path.join(repoPath, "large.txt"), "0123456789\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function initEmptyRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-empty-git-"));
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  return repoPath;
}

async function initConflictRepo() {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-conflict-"));
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "base\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  await runGit(["switch", "-c", "feature"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
  await runGit(["commit", "-am", "Feature edit"], { cwd: repoPath });
  await runGit(["switch", "main"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "main\n", "utf8");
  await runGit(["commit", "-am", "Main edit"], { cwd: repoPath });
  return repoPath;
}

async function initDefaultBranchRemoteRepo() {
  const repoPath = await initReadGitBlobRepo();
  const remotePath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-remote-"));
  tempDirs.push(remotePath);
  await runGit(["init", "--bare"], { cwd: remotePath });
  await runGit(["remote", "add", "origin", remotePath], { cwd: repoPath });
  await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
  await runGit(["fetch", "origin"], { cwd: repoPath });
  return { remotePath, repoPath };
}

async function pushRemoteMainCommit(remotePath: string) {
  const cloneParent = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-git-remote-clone-"),
  );
  tempDirs.push(cloneParent);
  const clonePath = path.join(cloneParent, "repo");
  await runGit(["clone", "--branch", "main", remotePath, clonePath], {
    cwd: cloneParent,
  });
  await runGit(["config", "user.name", "BB Tests"], { cwd: clonePath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: clonePath,
  });
  await fs.writeFile(path.join(clonePath, "remote.txt"), "remote\n", "utf8");
  await runGit(["add", "."], { cwd: clonePath });
  await runGit(["commit", "-m", "Remote edit"], { cwd: clonePath });
  await runGit(["push", "origin", "main"], { cwd: clonePath });
}

async function initSshRemoteRepo() {
  const repoPath = await initReadGitBlobRepo();
  const sshLogPath = path.join(repoPath, "ssh-invocations.log");
  const sshScriptPath = path.join(repoPath, "recording-ssh.sh");
  await fs.writeFile(
    sshScriptPath,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${JSON.stringify(sshLogPath.replaceAll("\\", "/"))}\nprintf 'GIT_TERMINAL_PROMPT=%s\\n' "\${GIT_TERMINAL_PROMPT-unset}" >> ${JSON.stringify(sshLogPath.replaceAll("\\", "/"))}\nexit 255\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  await runGit(["remote", "add", "origin", "ssh://git.invalid/repo.git"], {
    cwd: repoPath,
  });
  await runGit(
    [
      "config",
      "core.sshCommand",
      "'" + sshScriptPath.replaceAll("\\", "/").replaceAll("'", "'\\''") + "'",
    ],
    { cwd: repoPath },
  );
  return { repoPath, sshLogPath };
}

async function initBareWorktreeLayout() {
  const origin = await initReadGitBlobRepo();
  await runGit(["branch", "feature-a"], { cwd: origin });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-bare-layout-"));
  tempDirs.push(root);
  await runGit(["clone", "--bare", origin, ".bare"], { cwd: root });
  await fs.writeFile(path.join(root, ".git"), "gitdir: ./.bare\n", "utf8");
  await runGit(["worktree", "add", "feature-a", "feature-a"], { cwd: root });
  return { root, worktreePath: path.join(root, "feature-a") };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

describe("runGit", () => {
  it("scrubs inherited bb runtime env vars and node mode", async () => {
    const repoPath = await initEmptyRepo();
    vi.stubEnv("BB_DATA_DIR", "/tmp/leaked-bb-data");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OPENAI_API_KEY", "external-secret");

    const result = await runGit(
      [
        "-c",
        `alias.env-probe=!printf '%s|%s|%s' "\${BB_DATA_DIR-missing}" "\${NODE_ENV-missing}" "\${OPENAI_API_KEY-missing}"`,
        "env-probe",
      ],
      { cwd: repoPath },
    );

    expect(result.stdout).toBe("missing|missing|external-secret");
  });
});

describe("detectGitRepoKind", () => {
  it("tells a bare repository root apart from its worktrees and plain directories", async () => {
    const { root, worktreePath } = await initBareWorktreeLayout();
    const plainDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-plain-dir-"));
    tempDirs.push(plainDir);

    await expect(detectGitRepoKind(root)).resolves.toBe("bare");
    await expect(detectGitRepoKind(path.join(root, ".bare"))).resolves.toBe(
      "bare",
    );
    await expect(detectGitRepoKind(worktreePath)).resolves.toBe("work-tree");
    await expect(detectGitRepoKind(plainDir)).resolves.toBe("none");
  });

  it("keeps detectGitRepo scoped to work trees so bare roots get no checkout UI", async () => {
    const { root, worktreePath } = await initBareWorktreeLayout();

    await expect(detectGitRepo(root)).resolves.toBe(false);
    await expect(detectGitRepo(worktreePath)).resolves.toBe(true);
  });
});

describe("readDefaultBranchRefs", () => {
  it("reports equal local and origin defaults", async () => {
    const { repoPath } = await initDefaultBranchRemoteRepo();

    await expect(readDefaultBranchRefs(repoPath)).resolves.toEqual({
      defaultBranch: "main",
      defaultBranchRelation: "equal",
      originDefaultBranch: "origin/main",
    });
  });

  it("reports a local default behind origin", async () => {
    const { remotePath, repoPath } = await initDefaultBranchRemoteRepo();
    await pushRemoteMainCommit(remotePath);
    await runGit(["fetch", "origin"], { cwd: repoPath });

    await expect(readDefaultBranchRefs(repoPath)).resolves.toMatchObject({
      defaultBranch: "main",
      defaultBranchRelation: "local-behind",
      originDefaultBranch: "origin/main",
    });
  });

  it("reports a local default ahead of origin", async () => {
    const { repoPath } = await initDefaultBranchRemoteRepo();
    await fs.writeFile(path.join(repoPath, "local.txt"), "local\n", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "Local edit"], { cwd: repoPath });

    await expect(readDefaultBranchRefs(repoPath)).resolves.toMatchObject({
      defaultBranch: "main",
      defaultBranchRelation: "local-ahead",
      originDefaultBranch: "origin/main",
    });
  });

  it("reports diverged local and origin defaults", async () => {
    const { remotePath, repoPath } = await initDefaultBranchRemoteRepo();
    await fs.writeFile(path.join(repoPath, "local.txt"), "local\n", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "Local edit"], { cwd: repoPath });
    await pushRemoteMainCommit(remotePath);
    await runGit(["fetch", "origin"], { cwd: repoPath });

    await expect(readDefaultBranchRefs(repoPath)).resolves.toMatchObject({
      defaultBranch: "main",
      defaultBranchRelation: "diverged",
      originDefaultBranch: "origin/main",
    });
  });

  it("omits origin defaults when no origin ref exists", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(readDefaultBranchRefs(repoPath)).resolves.toEqual({
      defaultBranch: "main",
      defaultBranchRelation: undefined,
      originDefaultBranch: undefined,
    });
  });
});

describe("command timeouts", () => {
  it("classifies git command timeouts as hard failures when allowFailure is true", async () => {
    const repoPath = await initEmptyRepo();

    await fs.writeFile(path.join(repoPath, ".git", "packed-refs.lock"), "");
    await expect(
      runGit(["-c", "core.packedRefsTimeout=10000", "pack-refs", "--all"], {
        cwd: repoPath,
        allowFailure: true,
        timeoutMs: 500,
      }),
    ).rejects.toMatchObject({
      code: "git_command_timeout",
      name: "WorkspaceError",
    });
  });
});

describe("user-shell Git resolution", () => {
  it("uses the resolved shell PATH for Git commands", async () => {
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "bb-git-shell-path-workspace-"),
    );
    const binPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "bb-git-shell-path-bin-"),
    );
    tempDirs.push(workspacePath, binPath);
    await fs.writeFile(
      path.join(binPath, process.platform === "win32" ? "git.cmd" : "git"),
      process.platform === "win32"
        ? "@echo off\r\necho user-shell-git\r\n"
        : "#!/bin/sh\nprintf 'user-shell-git\\n'\n",
      { mode: 0o755 },
    );

    await expect(
      runGit(["--version"], { cwd: workspacePath, shellPath: binPath }),
    ).resolves.toMatchObject({
      stdout: expect.stringMatching(/^user-shell-git\r?\n$/),
    });
  });
});

describe("parsePorcelainV2StatusZ", () => {
  const readStatus = async (repoPath: string) =>
    parsePorcelainV2StatusZ(
      (
        await runGit(
          [
            "status",
            "--porcelain=v2",
            "--branch",
            "-z",
            "--untracked-files=all",
          ],
          { cwd: repoPath },
        )
      ).stdout,
    );

  it.skipIf(process.platform === "win32")(
    "reads renames, unusual paths, and the checked-out commit",
    async () => {
      const repoPath = await initConflictRepo();
      await fs.writeFile(path.join(repoPath, "old name.txt"), "rename me\n");
      await runGit(["add", "."], { cwd: repoPath });
      await runGit(["commit", "-m", "Add file"], { cwd: repoPath });
      await runGit(["mv", "old name.txt", "new -> name.txt"], {
        cwd: repoPath,
      });
      await fs.writeFile(path.join(repoPath, "README.md"), "edited\n");
      await fs.writeFile(path.join(repoPath, "line\nbreak.txt"), "new\n");
      const head = (
        await runGit(["rev-parse", "HEAD"], { cwd: repoPath })
      ).stdout.trim();

      const status = await readStatus(repoPath);

      expect(status.headOid).toBe(head);
      expect(status.headBranch).toBe("main");
      expect(status.entries).toEqual(
        expect.arrayContaining([
          {
            path: "README.md",
            status: "M",
            indexStatus: " ",
            worktreeStatus: "M",
          },
          {
            path: "new -> name.txt",
            status: "R",
            indexStatus: "R",
            worktreeStatus: " ",
          },
          {
            path: "line\nbreak.txt",
            status: "??",
            indexStatus: "?",
            worktreeStatus: "?",
          },
        ]),
      );
      expect(status.entries).toHaveLength(3);

      await runGit(["checkout", "--detach"], { cwd: repoPath });
      expect(await readStatus(repoPath)).toMatchObject({
        headOid: head,
        headBranch: null,
      });
    },
  );

  it("reads unmerged entries during a conflicted merge", async () => {
    const repoPath = await initConflictRepo();
    await runGit(["merge", "feature"], { cwd: repoPath, allowFailure: true });

    expect((await readStatus(repoPath)).entries).toEqual([
      {
        path: "README.md",
        status: "UU",
        indexStatus: "U",
        worktreeStatus: "U",
      },
    ]);
  });

  it("reports an unborn branch without a commit", async () => {
    const repoPath = await initEmptyRepo();
    expect(await readStatus(repoPath)).toEqual({
      entries: [],
      headOid: null,
      headBranch: "main",
    });
  });
});

describe("fetchRemoteBranches", () => {
  it("keeps a non-interactive fetch from prompting for ssh or git credentials", async () => {
    const { repoPath, sshLogPath } = await initSshRemoteRepo();

    await expect(
      fetchRemoteBranches(repoPath, { interactive: false }),
    ).resolves.toEqual({ status: "failed" });

    const log = await fs.readFile(sshLogPath, "utf8");
    expect(log).not.toContain("BatchMode");
    expect(log).toContain("GIT_TERMINAL_PROMPT=0\n");
  });

  it("leaves an interactive fetch free to prompt", async () => {
    const { repoPath, sshLogPath } = await initSshRemoteRepo();

    await expect(
      fetchRemoteBranches(repoPath, { interactive: true }),
    ).resolves.toEqual({ status: "failed" });

    const log = await fs.readFile(sshLogPath, "utf8");
    expect(log).not.toContain("BatchMode");
    expect(log).toContain("GIT_TERMINAL_PROMPT=unset\n");
  });
});
