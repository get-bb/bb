import { execFile } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
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
  await appendFile(
    join(directory, ".git", "config"),
    "\n[user]\n\tname = BB Tests\n\temail = bb@example.com\n[core]\n\tautocrlf = false\n",
    "utf8",
  );
  if (commit) {
    await writeFile(join(directory, "README.md"), "hello\n", "utf8");
    await git(directory, ["add", "README.md"]);
    await git(directory, ["commit", "-q", "-m", "Initial commit"]);
  }
  return directory;
}
