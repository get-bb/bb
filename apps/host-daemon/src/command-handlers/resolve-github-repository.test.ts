import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  githubNwoFromRemote,
  parseGithubFullName,
  resolveGithubRepository,
} from "./resolve-github-repository.js";

const execFileAsync = promisify(execFile);

async function writeOrigin(repoPath: string, originUrl: string): Promise<void> {
  const gitDir = join(repoPath, ".git");
  await mkdir(gitDir, { recursive: true });
  await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(
    join(gitDir, "config"),
    `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${originUrl}\n`,
  );
}

describe("githubNwoFromRemote", () => {
  it("collapses GitHub SSH and HTTPS remotes to owner/repo", () => {
    expect(githubNwoFromRemote("git@github.com:Timmoshu/cc-sandbox.git")).toBe(
      "timmoshu/cc-sandbox",
    );
    expect(githubNwoFromRemote("https://github.com/timmoshu/cc-sandbox")).toBe(
      "timmoshu/cc-sandbox",
    );
    expect(
      githubNwoFromRemote("ssh://git@github.com/timmoshu/cc-sandbox.git"),
    ).toBe("timmoshu/cc-sandbox");
    expect(
      githubNwoFromRemote(
        "https://user:token@github.com/timmoshu/cc-sandbox.git",
      ),
    ).toBe("timmoshu/cc-sandbox");
    expect(
      githubNwoFromRemote("git@github.com-work:timmoshu/cc-sandbox.git"),
    ).toBe("timmoshu/cc-sandbox");
    expect(githubNwoFromRemote("https://gitlab.com/timmoshu/cc-sandbox")).toBe(
      null,
    );
  });
});

describe("resolveGithubRepository", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bb-resolve-gh-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns an unresolved identity when the GitHub id cannot be named", async () => {
    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [],
      dataDir: join(root, "data"),
      home: join(root, "home"),
      resolveFullName: async () => null,
    });
    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("matches a known BB project path for the cc-sandbox GitHub id", async () => {
    const sourcePath = join(root, "srv", "cc-sandbox");
    await writeOrigin(sourcePath, "https://github.com/timmoshu/cc-sandbox.git");

    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [sourcePath],
      dataDir: join(root, "data"),
      home: join(root, "home"),
      resolveFullName: async () => parseGithubFullName("timmoshu/cc-sandbox"),
    });

    expect(result).toEqual({
      outcome: "found",
      repository: {
        path: sourcePath,
        name: "cc-sandbox",
      },
    });
  });

  it("prefers an existing dataDir checkout when known paths miss", async () => {
    const dataDir = join(root, "data");
    const checkout = join(dataDir, "checkouts", "cc-sandbox");
    await writeOrigin(checkout, "git@github.com:timmoshu/cc-sandbox.git");
    await writeOrigin(
      join(root, "other", "unrelated"),
      "https://github.com/example/other.git",
    );

    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [join(root, "missing")],
      dataDir,
      home: join(root, "home"),
      resolveFullName: async () => "timmoshu/cc-sandbox",
    });

    expect(result.outcome).toBe("found");
    if (result.outcome !== "found") throw new Error("expected a match");
    expect(result.repository.path).toBe(checkout);
  });

  it("matches a home-directory checkout when earlier tiers miss", async () => {
    const home = join(root, "home");
    const discovered = join(home, "projects", "cc-sandbox");
    await writeOrigin(discovered, "https://github.com/timmoshu/cc-sandbox.git");

    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [],
      dataDir: join(root, "data"),
      home,
      env: { PATH: "/nonexistent" },
      resolveFullName: async () => "timmoshu/cc-sandbox",
    });

    expect(result).toEqual({
      outcome: "found",
      repository: {
        path: discovered,
        name: "cc-sandbox",
      },
    });
  });

  it("matches a linked worktree discovered under the home directory", async () => {
    const source = join(root, "source");
    const home = join(root, "home");
    const worktree = join(home, "cc-sandbox-worktree");
    await mkdir(source, { recursive: true });
    await mkdir(home, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: source });
    await execFileAsync("git", ["config", "user.name", "BB Tests"], {
      cwd: source,
    });
    await execFileAsync("git", ["config", "user.email", "bb@example.com"], {
      cwd: source,
    });
    await writeFile(join(source, "README.md"), "ready\n");
    await execFileAsync("git", ["add", "README.md"], { cwd: source });
    await execFileAsync("git", ["commit", "-m", "Initial"], { cwd: source });
    await execFileAsync(
      "git",
      ["remote", "add", "origin", "git@github.com:timmoshu/cc-sandbox.git"],
      { cwd: source },
    );
    await execFileAsync("git", ["worktree", "add", "-b", "linked", worktree], {
      cwd: source,
    });

    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [],
      dataDir: join(root, "data"),
      home,
      resolveFullName: async () => "timmoshu/cc-sandbox",
    });

    expect(result).toMatchObject({
      outcome: "found",
      repository: { path: worktree },
    });
  });

  it("picks the lexicographically smallest path when one tier has two matches", async () => {
    const alpha = join(root, "srv", "alpha");
    const beta = join(root, "srv", "beta");
    await writeOrigin(alpha, "https://github.com/timmoshu/cc-sandbox.git");
    await writeOrigin(beta, "https://github.com/timmoshu/cc-sandbox.git");

    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [beta, alpha],
      dataDir: join(root, "data"),
      home: join(root, "home"),
      resolveFullName: async () => "timmoshu/cc-sandbox",
    });

    expect(result.outcome).toBe("found");
    if (result.outcome !== "found") throw new Error("expected a match");
    expect(result.repository.path).toBe(alpha);
  });

  it("confirms a miss when the host has no matching checkout", async () => {
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [],
      dataDir: join(root, "data"),
      home,
      env: { PATH: "/nonexistent" },
      resolveFullName: async () => "timmoshu/cc-sandbox",
    });
    expect(result).toEqual({ outcome: "not_found" });
  });

  it("does not claim a confirmed miss when home discovery is unreadable", async () => {
    const home = join(root, "home");
    const discovered = join(home, "projects", "cc-sandbox");
    await writeOrigin(discovered, "https://github.com/timmoshu/cc-sandbox.git");
    await chmod(home, 0o000);
    try {
      const result = await resolveGithubRepository({
        providerRepositoryId: "1268425814",
        knownPaths: [],
        dataDir: join(root, "data"),
        home,
        env: { PATH: "/nonexistent" },
        resolveFullName: async () => "timmoshu/cc-sandbox",
      });
      expect(result).toEqual({ outcome: "unavailable" });
    } finally {
      await chmod(home, 0o700);
    }
  });

  it("does not claim a confirmed miss when a known path is unreadable", async () => {
    const sourcePath = join(root, "srv", "cc-sandbox");
    await writeOrigin(sourcePath, "https://github.com/timmoshu/cc-sandbox.git");
    await chmod(sourcePath, 0o000);
    try {
      const result = await resolveGithubRepository({
        providerRepositoryId: "1268425814",
        knownPaths: [sourcePath],
        dataDir: join(root, "data"),
        home: join(root, "home"),
        resolveFullName: async () => "timmoshu/cc-sandbox",
        discover: async () => ({ repos: [], truncated: false }),
      });
      expect(result).toEqual({ outcome: "unavailable" });
    } finally {
      await chmod(sourcePath, 0o700);
    }
  });

  it("does not claim a confirmed miss when the home walk is truncated", async () => {
    const result = await resolveGithubRepository({
      providerRepositoryId: "1268425814",
      knownPaths: [],
      dataDir: join(root, "data"),
      home: join(root, "home"),
      resolveFullName: async () => "timmoshu/cc-sandbox",
      discover: async () => ({ repos: [], truncated: true }),
    });

    expect(result).toEqual({ outcome: "unavailable" });
  });

  it("does not claim a confirmed miss when the checkout inventory is unreadable", async () => {
    const dataDir = join(root, "data");
    const checkouts = join(dataDir, "checkouts");
    await mkdir(checkouts, { recursive: true });
    await chmod(checkouts, 0o000);
    try {
      const result = await resolveGithubRepository({
        providerRepositoryId: "1268425814",
        knownPaths: [],
        dataDir,
        home: join(root, "home"),
        resolveFullName: async () => "timmoshu/cc-sandbox",
        discover: async () => ({ repos: [], truncated: false }),
      });

      expect(result).toEqual({ outcome: "unavailable" });
    } finally {
      await chmod(checkouts, 0o700);
    }
  });
});
