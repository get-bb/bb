import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

export async function initRepo(
  directory: string,
  { commit = true }: { commit?: boolean } = {},
): Promise<string> {
  await git(directory, ["init", "-q", "-b", "main"]);
  await git(directory, ["config", "user.name", "BB Tests"]);
  await git(directory, ["config", "user.email", "bb@example.com"]);
  await git(directory, ["config", "core.autocrlf", "false"]);
  if (commit) {
    await writeFile(join(directory, "README.md"), "hello\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-q", "-m", "Initial commit"]);
  }
  return directory;
}
