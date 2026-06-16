import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..", "..");

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

describe("bb bin wrapper", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-bin-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function createFakeRepo(): Promise<string> {
    const fakeRepoRoot = join(tempRoot, "repo");
    const fakeBinDir = join(fakeRepoRoot, "apps", "cli", "bin");
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      join(fakeRepoRoot, "package.json"),
      JSON.stringify({ name: "bb", private: true }),
    );
    await copyFile(
      join(repoRoot, "apps", "cli", "bin", "bb"),
      join(fakeBinDir, "bb"),
    );
    await chmod(join(fakeBinDir, "bb"), 0o755);
    return fakeRepoRoot;
  }

  async function writeFakePnpm(content: string): Promise<string> {
    const fakeBinDir = join(tempRoot, "fake-bin");
    await mkdir(fakeBinDir, { recursive: true });
    const fakePnpmPath = join(fakeBinDir, "pnpm");
    await writeFile(fakePnpmPath, content, { mode: 0o755 });
    await chmod(fakePnpmPath, 0o755);
    return fakeBinDir;
  }

  it("builds the source CLI before executing when dist is missing", async () => {
    const fakeRepoRoot = await createFakeRepo();
    const pnpmArgsPath = join(tempRoot, "pnpm-args.txt");
    const fakePnpmDir = await writeFakePnpm(`#!/bin/sh
printf '%s\\n' "$@" > ${shellQuote(pnpmArgsPath)}
repo_root=""
previous=""
for arg do
  if [ "$previous" = "-C" ]; then
    repo_root="$arg"
    break
  fi
  previous="$arg"
done
mkdir -p "$repo_root/apps/cli/dist"
cat > "$repo_root/apps/cli/dist/index.js" <<'NODE'
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));
NODE
`);

    const result = await execFileAsync(
      join(fakeRepoRoot, "apps", "cli", "bin", "bb"),
      ["status", "--json"],
      {
        cwd: fakeRepoRoot,
        env: {
          ...process.env,
          PATH: `${fakePnpmDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(JSON.parse(result.stdout)).toEqual({ argv: ["status", "--json"] });
    await expect(
      readFile(join(fakeRepoRoot, "apps", "cli", "dist", "index.js"), "utf8"),
    ).resolves.toContain("process.stdout.write");
    await expect(readFile(pnpmArgsPath, "utf8")).resolves.toBe(
      ["-C", fakeRepoRoot, "run", "--silent", "cli:prepare", ""].join("\n"),
    );
  });

  it("uses the built CLI directly when dist exists", async () => {
    const fakeRepoRoot = await createFakeRepo();
    const fakeDistDir = join(fakeRepoRoot, "apps", "cli", "dist");
    const pnpmCalledPath = join(tempRoot, "pnpm-called.txt");
    const fakePnpmDir = await writeFakePnpm(`#!/bin/sh
echo called > ${shellQuote(pnpmCalledPath)}
exit 42
`);
    await mkdir(fakeDistDir, { recursive: true });
    await writeFile(
      join(fakeDistDir, "index.js"),
      "process.stdout.write(process.argv.slice(2).join(' '));\n",
    );

    const result = await execFileAsync(
      join(fakeRepoRoot, "apps", "cli", "bin", "bb"),
      ["--help"],
      {
        cwd: fakeRepoRoot,
        env: {
          ...process.env,
          PATH: `${fakePnpmDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.stdout).toBe("--help");
    await expect(readFile(pnpmCalledPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
