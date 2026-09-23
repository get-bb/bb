import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitCheckoutFixture {
  checkout: string;
  cleanup: () => void;
  root: string;
  upstream: string;
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["-c", "user.name=bb test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  );
  return stdout.trim();
}

export function writeRepoFile(
  repo: string,
  path: string,
  contents: string,
): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), contents);
}

export async function commitVersion(
  repo: string,
  version: string,
  subject: string,
): Promise<string> {
  writeRepoFile(
    repo,
    "packages/bb-app/package.json",
    `${JSON.stringify({ name: "bb-app", version })}\n`,
  );
  await git(repo, "add", "-A");
  await git(repo, "commit", "-q", "-m", subject);
  return git(repo, "rev-parse", "HEAD");
}

export async function createGitCheckout(): Promise<GitCheckoutFixture> {
  const root = mkdtempSync(join(tmpdir(), "bb-app-update-git-"));
  const origin = join(root, "origin.git");
  const upstream = join(root, "upstream");
  const checkout = join(root, "checkout");
  await git(root, "init", "-q", "--bare", "-b", "main", origin);
  await git(root, "init", "-q", "-b", "main", upstream);
  await git(upstream, "remote", "add", "origin", origin);
  await commitVersion(upstream, "1.0.0", "Initial commit");
  await git(upstream, "push", "-q", "origin", "main");
  await git(root, "clone", "-q", origin, checkout);
  return {
    checkout,
    cleanup: () => rmSync(root, { force: true, recursive: true }),
    root,
    upstream,
  };
}

export async function publish(
  upstream: string,
  version: string,
  subject: string,
): Promise<string> {
  const commit = await commitVersion(upstream, version, subject);
  await git(upstream, "push", "-q", "origin", "main");
  return commit;
}
