import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "@bb/host-workspace";
import { listWorkspacePaths } from "./file-list.js";
import { listHostPaths } from "./host-files.js";

const roots: string[] = [];

async function createRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-workspace-paths-"));
  roots.push(root);
  return root;
}

async function write(root: string, file: string, content = "fixture") {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
}

async function initRepo(root: string) {
  await runGit(["init", "-b", "main"], { cwd: root });
}

function listingArgs(root: string) {
  return {
    root,
    includeFiles: true,
    includeDirectories: true,
    includeHidden: true,
    respectGitIgnore: true,
    excludeNames: [],
  };
}

async function paths(root: string) {
  return (await listWorkspacePaths(listingArgs(root)))
    .map((entry) => entry.path)
    .sort();
}

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("workspace path discovery", () => {
  it("includes tracked and non-ignored untracked files while pruning Git-ignored trees", async () => {
    const root = await createRoot();
    await initRepo(root);
    await write(root, ".github/workflows/ci.yml");
    await write(root, ".generated/tracked.txt");
    await runGit(["add", "."], { cwd: root });
    await write(
      root,
      ".gitignore",
      ".generated/\ncustom-cache/\n.state/*\n!.state/keep.txt\n",
    );
    await write(root, ".git/info/exclude", "local-output/\n");
    await write(root, ".generated/deep/ignored.txt");
    await write(root, "custom-cache/arbitrary-tool/ignored.txt");
    await write(root, "local-output/ignored.txt");
    await write(root, ".state/drop.txt");
    await write(root, ".state/keep.txt");
    await write(root, "src/new\nfile.ts");
    await write(root, "src/ignored\nfile.log");
    await write(root, "src/.gitignore", "*.log\n");
    await fs.mkdir(path.join(root, "empty"));
    await fs.symlink("src/new\nfile.ts", path.join(root, "link.ts"));

    expect(await paths(root)).toEqual([
      ".generated",
      ".generated/tracked.txt",
      ".github",
      ".github/workflows",
      ".github/workflows/ci.yml",
      ".gitignore",
      ".state",
      ".state/keep.txt",
      "empty",
      "src",
      "src/.gitignore",
      "src/new\nfile.ts",
    ]);
  });

  it("resolves ignore rules relative to a subdirectory and a linked worktree", async () => {
    const root = await createRoot();
    await initRepo(root);
    await write(root, ".gitignore", "/.sandboxes/\n*.log\n");
    await write(root, "src/README.md");
    await runGit(["add", "."], { cwd: root });
    await runGit(
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root },
    );
    const worktree = path.join(root, ".sandboxes", "worker");
    await runGit(["worktree", "add", "--detach", worktree], { cwd: root });
    await write(worktree, "src/trace.log");
    await write(worktree, "src/new.ts");

    expect(await paths(root)).not.toContain(".sandboxes");
    expect(await paths(path.join(worktree, "src"))).toEqual([
      "README.md",
      "new.ts",
    ]);
    expect(await paths(worktree)).toContain("src/new.ts");
  });

  it("preserves filesystem listings without Git and when ignore filtering is disabled", async () => {
    const root = await createRoot();
    await write(root, ".gitignore", "output/\n");
    await write(root, "output/result.txt");
    await write(root, ".claude/settings.json");
    await write(root, ".claude/worktrees/worker/README.md");
    await write(root, "src/worktrees/index.ts");
    const args = { ...listingArgs(root), excludeNames: [".claude/worktrees"] };
    expect((await listWorkspacePaths(args)).map((entry) => entry.path)).toEqual(
      [
        ".claude",
        ".claude/settings.json",
        ".gitignore",
        "output",
        "output/result.txt",
        "src",
        "src/worktrees",
        "src/worktrees/index.ts",
      ],
    );
    await initRepo(root);
    expect(await paths(root)).not.toContain("output/result.txt");
    expect(
      (await listWorkspacePaths({ ...args, respectGitIgnore: false })).map(
        (entry) => entry.path,
      ),
    ).toContain("output/result.txt");
    expect(
      (await listWorkspacePaths({ ...args, includeHidden: false })).map(
        (entry) => entry.path,
      ),
    ).toEqual(["src", "src/worktrees", "src/worktrees/index.ts"]);
  });

  it("shares pending discovery but refreshes completed results and ignore rules", async () => {
    const root = await createRoot();
    await initRepo(root);
    await write(root, "first.txt");
    const args = listingArgs(root);
    const first = listWorkspacePaths(args);
    const second = listWorkspacePaths({ ...args, excludeNames: [] });
    expect(second).toBe(first);
    await first;
    await write(root, "second.txt");
    await write(root, ".gitignore", "first.txt\n");
    expect(await paths(root)).toEqual([".gitignore", "second.txt"]);

    const hidden = listWorkspacePaths(args);
    const visible = listWorkspacePaths({ ...args, includeHidden: false });
    expect((await hidden).map((entry) => entry.path)).toContain(".gitignore");
    expect((await visible).map((entry) => entry.path)).not.toContain(
      ".gitignore",
    );
  });

  it("does not retain failed discovery", async () => {
    const root = path.join(await createRoot(), "missing");
    await expect(listWorkspacePaths(listingArgs(root))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await write(root, "recovered.txt");
    expect(await paths(root)).toEqual(["recovered.txt"]);
  });

  it("ranks concurrent queries independently over the shared listing", async () => {
    const root = await createRoot();
    await initRepo(root);
    await write(root, "alpha.md");
    await write(root, "beta.md");
    const command = {
      type: "host.list_paths" as const,
      path: root,
      includeFiles: true,
      includeDirectories: false,
      includeHidden: true,
      respectGitIgnore: true,
      excludeNames: [],
      limit: 1,
    };
    const [alpha, beta] = await Promise.all([
      listHostPaths({ ...command, query: "alpha" }),
      listHostPaths({ ...command, query: "beta" }),
    ]);
    expect(alpha.paths.map((entry) => entry.path)).toEqual(["alpha.md"]);
    expect(beta.paths.map((entry) => entry.path)).toEqual(["beta.md"]);
  });
});
