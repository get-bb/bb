import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type RepositorySize = "few" | "many";

export const REPOSITORY_SIZES: Record<
  RepositorySize,
  { branches: number; worktrees: number; baseCommits: number }
> = {
  few: { branches: 2, worktrees: 1, baseCommits: 2 },
  many: { branches: 400, worktrees: 12, baseCommits: 600 },
};

export interface BudgetRepository {
  checkout: string;
  origin: string;
  worktrees: string[];
  git(cwd: string, args: string[], input?: string): Promise<string>;
}

let fixtureCount = 0;

export async function createBudgetRepository(args: {
  root: string;
  realGit: string;
  size: RepositorySize;
}): Promise<BudgetRepository> {
  const shape = REPOSITORY_SIZES[args.size];
  fixtureCount += 1;
  const dir = path.join(args.root, `repo-${fixtureCount}-${args.size}`);
  const origin = path.join(dir, "origin.git");
  const checkout = path.join(dir, "project");
  const githubUrl = `https://github.com/bb-budget/repo-${fixtureCount}.git`;

  async function git(
    cwd: string,
    gitArgs: string[],
    input?: string,
  ): Promise<string> {
    const child = execFileAsync(args.realGit, gitArgs, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (input !== undefined) {
      child.child.stdin?.end(input);
    }
    return (await child).stdout;
  }

  await fs.mkdir(dir, { recursive: true });
  await git(dir, ["init", "-q", "--bare", "--initial-branch=main", origin]);
  await git(origin, ["fast-import", "--quiet"], initialHistory());
  await git(
    origin,
    ["update-ref", "--stdin"],
    Array.from(
      { length: shape.branches },
      (_, index) => `create refs/heads/remote-${index} refs/heads/main\n`,
    ).join(""),
  );
  await git(dir, ["clone", "-q", origin, checkout]);
  await git(checkout, ["config", "user.name", "Budget"]);
  await git(checkout, ["config", "user.email", "budget@example.test"]);
  await git(checkout, ["config", "remote.origin.url", githubUrl]);
  await git(checkout, ["config", `url.${origin}.insteadOf`, githubUrl]);
  await git(
    checkout,
    ["update-ref", "--stdin"],
    Array.from(
      { length: shape.branches },
      (_, index) => `create refs/heads/local-${index} refs/heads/main\n`,
    ).join(""),
  );
  const worktrees: string[] = [];
  for (let index = 0; index < shape.worktrees; index += 1) {
    const worktree = path.join(dir, `worktree-${index}`);
    await git(checkout, [
      "worktree",
      "add",
      "-q",
      "-b",
      `worktree-${index}`,
      worktree,
      "main",
    ]);
    worktrees.push(worktree);
  }
  return {
    checkout: await fs.realpath(checkout),
    origin,
    worktrees: await Promise.all(worktrees.map((entry) => fs.realpath(entry))),
    git,
  };
}

function initialHistory(): string {
  const files = [
    ["README.md", "# Budget\n"],
    ["src/app.ts", "export const app = 1;\n"],
  ];
  const commands = [
    "commit refs/heads/main",
    "committer Budget <budget@example.test> 1700000000 +0000",
    "data 7",
    "initial",
  ];
  for (const [file, content] of files) {
    commands.push(
      `M 100644 inline ${file}`,
      `data ${Buffer.byteLength(content!)}`,
      content!,
    );
  }
  return `${commands.join("\n")}\n`;
}

export async function advanceBase(
  repository: BudgetRepository,
  size: RepositorySize,
): Promise<void> {
  const parent = (
    await repository.git(repository.origin, ["rev-parse", "refs/heads/main"])
  ).trim();
  const commands: string[] = [];
  for (let index = 0; index < REPOSITORY_SIZES[size].baseCommits; index += 1) {
    const content = `base ${index}\n`;
    commands.push(
      "commit refs/heads/main",
      `committer Budget <budget@example.test> ${1700000100 + index} +0000`,
      `data ${`base ${index}`.length}`,
      `base ${index}`,
      ...(index === 0 ? [`from ${parent}`] : []),
      `M 100644 inline base/${index}.txt`,
      `data ${content.length}`,
      content,
    );
  }
  await repository.git(
    repository.origin,
    ["fast-import", "--quiet"],
    `${commands.join("\n")}\n`,
  );
  await repository.git(repository.checkout, ["fetch", "-q", "origin"]);
  await repository.git(repository.checkout, [
    "merge",
    "-q",
    "--ff-only",
    "origin/main",
  ]);
}
