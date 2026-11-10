import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const REPO_TEMPLATE_ENV = "BB_TEST_GIT_REPO_TEMPLATE";

export interface CreateTestFileOptions {
  content: string;
  filePath: string;
}

export interface TestRepoFile {
  content: string;
  relativePath: string;
}

export interface CreateTestGitRepoOptions {
  files?: TestRepoFile[];
  repoDir: string;
}

export interface RunGitOptions {
  args: string[];
  cwd: string;
}

const DEFAULT_REPO_FILES: TestRepoFile[] = [
  {
    relativePath: "alpha.txt",
    content: "alpha\n",
  },
  {
    relativePath: "beta.md",
    content: "# Beta\n\nInitial content.\n",
  },
];

export async function createTestFile(
  options: CreateTestFileOptions,
): Promise<string> {
  await fs.mkdir(path.dirname(options.filePath), { recursive: true });
  await fs.writeFile(options.filePath, options.content, "utf8");
  return options.filePath;
}

export async function runGit(options: RunGitOptions): Promise<string> {
  const result = await execFile("git", options.args, {
    cwd: options.cwd,
  });
  return result.stdout ?? "";
}

export async function createTestGitRepo(
  options: CreateTestGitRepoOptions,
): Promise<string> {
  const template = process.env[REPO_TEMPLATE_ENV];
  if (template !== undefined && options.files === undefined) {
    await fs.cp(template, options.repoDir, { recursive: true });
    return options.repoDir;
  }
  await fs.mkdir(options.repoDir, { recursive: true });
  await runGit({
    cwd: options.repoDir,
    args: ["init", "--initial-branch", "main"],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["config", "user.email", "integration-tests@example.com"],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["config", "user.name", "BB Integration Tests"],
  });

  for (const file of options.files ?? DEFAULT_REPO_FILES) {
    await createTestFile({
      content: file.content,
      filePath: path.join(options.repoDir, file.relativePath),
    });
  }

  await runGit({
    cwd: options.repoDir,
    args: ["add", "."],
  });
  await runGit({
    cwd: options.repoDir,
    args: ["commit", "-m", "Initial commit"],
  });
  return options.repoDir;
}

export async function setupTestGitRepoTemplate(): Promise<() => Promise<void>> {
  const repoDir = await fs.mkdtemp(
    path.join(tmpdir(), "bb-git-repo-template-"),
  );
  const previous = process.env[REPO_TEMPLATE_ENV];
  try {
    await createTestGitRepo({ repoDir, files: DEFAULT_REPO_FILES });
  } catch (error) {
    await fs.rm(repoDir, { recursive: true, force: true });
    throw error;
  }
  process.env[REPO_TEMPLATE_ENV] = repoDir;
  return async () => {
    if (previous === undefined) delete process.env[REPO_TEMPLATE_ENV];
    else process.env[REPO_TEMPLATE_ENV] = previous;
    await fs.rm(repoDir, { recursive: true, force: true });
  };
}
