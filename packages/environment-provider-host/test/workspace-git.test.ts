import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  detectGitRepo,
  detectGitRepoKind,
  ensureGitRepo,
  hasUncommittedChanges,
  isMissingHeadRevisionError,
  parsePorcelainV2StatusZ,
  readDefaultBranchRefs,
  runGit,
} from "../src/workspace-git.js";
import { fetchRemoteBranches } from "../src/branch-options.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function initReadGitBlobRepo() {
  const repoPath = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-read-git-blob-"),
  );
  tempDirs.push(repoPath);
  return populateReadGitBlobRepo(repoPath);
}

async function writeTestIdentity(repoPath: string) {
  await fs.appendFile(
    path.join(repoPath, ".git", "config"),
    "[user]\n\tname = BB Tests\n\temail = bb@example.com\n",
    "utf8",
  );
}

async function populateReadGitBlobRepo(repoPath: string) {
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await writeTestIdentity(repoPath);
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
  await writeTestIdentity(repoPath);
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
  it("reports the exit status of a silent Git failure", async () => {
    const repoPath = await initEmptyRepo();

    await expect(
      runGit(["config", "--local", "--get", "bb.missing-setting"], {
        cwd: repoPath,
      }),
    ).rejects.toMatchObject({
      name: "WorkspaceError",
      code: "git_command_failed",
      cause: { exitCode: 1, signal: null, message: "Git exited with code 1" },
    });
  });

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

describe("user Git settings on machine reads", () => {
  let templatePath: string;
  let standard: Awaited<ReturnType<typeof readPatches>>;

  beforeAll(async () => {
    templatePath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-display-"));
    await runGit(["init", "-b", "main"], { cwd: templatePath });
    await writeTestIdentity(templatePath);
    await fs.mkdir(path.join(templatePath, "app"));
    await fs.mkdir(path.join(templatePath, "sub"));
    await fs.writeFile(path.join(templatePath, "blank.txt"), "a\n\nb\n");
    await fs.writeFile(path.join(templatePath, "app", "inner.txt"), "one\n");
    await runGit(
      ["update-index", "--add", "--cacheinfo", `160000,${"1".repeat(40)},sub`],
      { cwd: templatePath },
    );
    await runGit(["add", "."], { cwd: templatePath });
    await runGit(["commit", "-m", "base"], { cwd: templatePath });
    await fs.writeFile(path.join(templatePath, "blank.txt"), "a\n\nB\n");
    await fs.writeFile(path.join(templatePath, "app", "inner.txt"), "two\n");
    await runGit(
      ["update-index", "--cacheinfo", `160000,${"2".repeat(40)},sub`],
      { cwd: templatePath },
    );
    await runGit(["commit", "-am", "change"], { cwd: templatePath });
    await fs.writeFile(path.join(templatePath, "blank.txt"), "a\n\nC\n");
  });

  beforeAll(async () => {
    standard = await readPatches({});
  });

  afterAll(() => fs.rm(templatePath, { recursive: true, force: true }));

  async function repoWithConfig(config: Record<string, string>) {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-display-"));
    tempDirs.push(parent);
    const repoPath = path.join(parent, "repo");
    await fs.cp(templatePath, repoPath, { recursive: true });
    for (const [key, value] of Object.entries(config)) {
      await runGit(["config", key, value], { cwd: repoPath });
    }
    return repoPath;
  }

  async function readPatches(config: Record<string, string>) {
    const globalConfig = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-display-config-")),
      "gitconfig",
    );
    tempDirs.push(path.dirname(globalConfig));
    await fs.writeFile(
      globalConfig,
      Object.entries(config)
        .map(([key, value]) => {
          const dot = key.lastIndexOf(".");
          return `[${key.slice(0, dot)}]\n\t${key.slice(dot + 1)} = ${value}\n`;
        })
        .join(""),
    );
    const options = {
      cwd: path.join(templatePath, "app"),
      env: { GIT_CONFIG_GLOBAL: globalConfig },
    };
    const [diff, log, show, worktree] = await Promise.all([
      runGit(["diff", "HEAD~1", "HEAD"], options),
      runGit(["log", "-p", "-1", "--format=%s"], options),
      runGit(["show", "--format=%s", "HEAD"], options),
      runGit(["diff", "HEAD", "--", ":/"], options),
    ]);
    return {
      diff: diff.stdout,
      log: log.stdout,
      show: show.stdout,
      worktree: worktree.stdout,
    };
  }

  it.for<[string, Record<string, string>]>([
    ["color.ui=always", { "color.ui": "always" }],
    ["color.diff=always", { "color.ui": "never", "color.diff": "always" }],
    ["diff.noprefix", { "diff.noprefix": "true" }],
    ["diff.mnemonicPrefix", { "diff.mnemonicPrefix": "true" }],
    [
      "diff.srcPrefix/dstPrefix",
      { "diff.srcPrefix": "x/", "diff.dstPrefix": "y/" },
    ],
    ["diff.suppressBlankEmpty", { "diff.suppressBlankEmpty": "true" }],
    ["diff.relative", { "diff.relative": "true" }],
    ["diff.submodule=log", { "diff.submodule": "log" }],
    ["diff.submodule=diff", { "diff.submodule": "diff" }],
  ])("keeps the standard patch format under %s", async ([, config]) => {
    expect(standard.diff).toContain("diff --git a/blank.txt b/blank.txt");
    expect(standard.diff).toContain(" a\n \n-b\n+B\n");
    expect(standard.diff).toContain("+Subproject commit 2222");
    expect(standard.diff).toContain("diff --git a/app/inner.txt");
    expect(standard.worktree).toContain("--- a/blank.txt\n+++ b/blank.txt");

    await expect(readPatches(config)).resolves.toEqual(standard);
  });

  it.skipIf(process.platform === "win32")(
    "reads Git messages in English when the user's language is translated",
    async () => {
      const binPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-lang-"));
      tempDirs.push(binPath);
      await fs.writeFile(
        path.join(binPath, "git"),
        [
          "#!/bin/sh",
          'if [ "$LANGUAGE" = C ]; then',
          "  echo \"fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\" >&2",
          "else",
          "  echo \"Schwerwiegend: mehrdeutiges Argument 'HEAD': unbekannter Commit\" >&2",
          "fi",
          'printf "%s|%s" "$LANG" "$LC_ALL"',
          "exit 128",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      vi.stubEnv("LANG", "de_DE.UTF-8");
      vi.stubEnv("LANGUAGE", "de");
      vi.stubEnv("LC_ALL", "de_DE.UTF-8");

      const result = await runGit(["rev-parse", "HEAD"], {
        cwd: binPath,
        shellPath: binPath,
        allowFailure: true,
      });

      expect(isMissingHeadRevisionError(result.stderr)).toBe(true);
      expect(result.stdout).toBe("de_DE.UTF-8|de_DE.UTF-8");
    },
  );

  it("keeps inherited and caller Git config alongside the overrides", async () => {
    const repoPath = await repoWithConfig({});
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "bb.inherited");
    vi.stubEnv("GIT_CONFIG_VALUE_0", "machine");

    const readConfig = async (key: string) =>
      (
        await runGit(["config", "--get", key], {
          cwd: repoPath,
          env: {
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: "core.splitIndex",
            GIT_CONFIG_VALUE_0: "false",
          },
        })
      ).stdout.trim();

    await expect(
      Promise.all(
        ["bb.inherited", "color.ui", "core.splitIndex"].map(readConfig),
      ),
    ).resolves.toEqual(["machine", "never", "false"]);
  });

  it.skipIf(process.platform === "win32")(
    "leaves signature checks out of log and show output under log.showSignature",
    async () => {
      const repoPath = await repoWithConfig({});
      const keyPath = path.join(path.dirname(repoPath), "signing-key");
      await execFileAsync("ssh-keygen", [
        "-q",
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        keyPath,
      ]);
      const allowedSigners = path.join(path.dirname(repoPath), "signers");
      await fs.writeFile(
        allowedSigners,
        `bb@example.com ${await fs.readFile(`${keyPath}.pub`, "utf8")}`,
      );
      for (const [key, value] of [
        ["gpg.format", "ssh"],
        ["user.signingKey", `${keyPath}.pub`],
        ["gpg.ssh.allowedSignersFile", allowedSigners],
        ["log.showSignature", "true"],
      ]) {
        await runGit(["config", key, value], { cwd: repoPath });
      }
      await runGit(["commit", "-S", "--allow-empty", "-m", "signed"], {
        cwd: repoPath,
      });
      const sha = (
        await runGit(["rev-parse", "HEAD"], { cwd: repoPath })
      ).stdout.trim();

      const log = await runGit(["log", "-1", "--format=%H"], {
        cwd: repoPath,
      });
      const show = await runGit(["show", "--format=%H", "--no-patch", "HEAD"], {
        cwd: repoPath,
      });

      expect([log.stdout, show.stdout]).toEqual([`${sha}\n`, `${sha}\n`]);
    },
  );
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

describe("hasUncommittedChanges", () => {
  it("counts untracked files nested in untracked folders but not ignored or empty ones", async () => {
    const repoPath = await initReadGitBlobRepo();
    await fs.writeFile(path.join(repoPath, ".gitignore"), "build/\n", "utf8");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "Ignore build"], { cwd: repoPath });
    await fs.mkdir(path.join(repoPath, "empty", "nested"), { recursive: true });
    await fs.mkdir(path.join(repoPath, "build"));
    await fs.writeFile(path.join(repoPath, "build", "out.js"), "x\n", "utf8");

    await expect(hasUncommittedChanges(repoPath)).resolves.toBe(false);

    await fs.mkdir(path.join(repoPath, "new", "deep"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "new", "deep", "a.txt"), "a\n");

    await expect(hasUncommittedChanges(repoPath)).resolves.toBe(true);
  });
});

describe("readDefaultBranchRefs", () => {
  let defaultBranchTemplate: string;

  beforeAll(async () => {
    defaultBranchTemplate = await fs.mkdtemp(
      path.join(os.tmpdir(), "bb-default-branch-template-"),
    );
    const options = { cwd: defaultBranchTemplate };
    await runGit(["init", "-q", "--template=", "-b", "main"], options);
    const commit = (ref: string, subject: string, parent?: string) =>
      [
        `commit ${ref}`,
        ...(parent === undefined ? ["mark :1"] : []),
        "committer BB Tests <bb@example.com> 0 +0000",
        `data ${Buffer.byteLength(subject)}`,
        subject,
        ...(parent === undefined ? [] : [`from ${parent}`]),
        "",
      ].join("\n");
    await runGit(["fast-import", "--quiet"], {
      ...options,
      input: [
        commit("refs/heads/main", "Initial commit"),
        "reset refs/remotes/origin/main\nfrom :1\n",
        commit("refs/tips/remote", "Remote edit", ":1"),
        commit("refs/tips/local", "Local edit", ":1"),
      ].join("\n"),
    });
  });

  afterAll(async () => {
    if (defaultBranchTemplate)
      await fs.rm(defaultBranchTemplate, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
  });

  async function copyDefaultBranchRepo(moves: Record<string, string> = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-default-branch-"));
    tempDirs.push(root);
    await fs.cp(defaultBranchTemplate, root, { recursive: true });
    const updates = Object.entries(moves);
    if (updates.length > 0) {
      await runGit(["update-ref", "--stdin"], {
        cwd: root,
        input: updates
          .map(([ref, target]) => `update ${ref} ${target}\n`)
          .join(""),
      });
    }
    return root;
  }

  const originMoved = { "refs/remotes/origin/main": "refs/tips/remote" };
  const localMoved = { "refs/heads/main": "refs/tips/local" };

  it("reports equal local and origin defaults", async () => {
    const repoPath = await copyDefaultBranchRepo();

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toEqual({
      defaultBranch: "main",
      defaultBranchRelation: "equal",
      originDefaultBranch: "origin/main",
      baseBranch: { ref: "origin/main", source: "origin" },
    });
  });

  it.for([
    ["a local default behind origin", originMoved, "local-behind"],
    ["a local default ahead of origin", localMoved, "local-ahead"],
    [
      "diverged local and origin defaults",
      { ...originMoved, ...localMoved },
      "diverged",
    ],
  ] as const)("reports %s", async ([, moves, relation]) => {
    const repoPath = await copyDefaultBranchRepo(moves);

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toMatchObject({
      defaultBranch: "main",
      defaultBranchRelation: relation,
      originDefaultBranch: "origin/main",
    });
  });

  it("prefers origin's default branch over main when both exist locally", async () => {
    const repoPath = await copyDefaultBranchRepo();
    await runGit(["branch", "develop"], { cwd: repoPath });
    await runGit(["update-ref", "refs/remotes/origin/develop", "develop"], {
      cwd: repoPath,
    });
    await runGit(
      [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/develop",
      ],
      { cwd: repoPath },
    );

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toMatchObject({
      defaultBranch: "develop",
      originDefaultBranch: "origin/develop",
    });
  });

  it("does not mistake a branch under main/ for main", async () => {
    const repoPath = await initReadGitBlobRepo();
    await runGit(["branch", "-m", "main", "zeta"], { cwd: repoPath });
    await runGit(["branch", "main/feature"], { cwd: repoPath });
    await runGit(["branch", "master"], { cwd: repoPath });

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toMatchObject({
      defaultBranch: "master",
    });
  });

  it("falls back to the first local branch by name without main or master", async () => {
    const repoPath = await initReadGitBlobRepo();
    await runGit(["branch", "-m", "main", "zeta"], { cwd: repoPath });
    await runGit(["branch", "beta"], { cwd: repoPath });

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toMatchObject({
      defaultBranch: "beta",
    });
  });

  it("still prefers origin/HEAD's branch locally when its remote ref is gone", async () => {
    const repoPath = await copyDefaultBranchRepo();
    await runGit(["branch", "develop"], { cwd: repoPath });
    await runGit(
      [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/develop",
      ],
      { cwd: repoPath },
    );

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toEqual({
      defaultBranch: "develop",
      defaultBranchRelation: undefined,
      originDefaultBranch: undefined,
      baseBranch: { ref: "develop", source: "local" },
    });
  });

  it("omits origin defaults when no origin ref exists", async () => {
    const repoPath = await initReadGitBlobRepo();

    await expect(
      readDefaultBranchRefs(await ensureGitRepo(repoPath)),
    ).resolves.toEqual({
      defaultBranch: "main",
      defaultBranchRelation: undefined,
      originDefaultBranch: undefined,
      baseBranch: { ref: "main", source: "local" },
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
