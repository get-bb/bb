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

function binEntryFileName(): string {
  return process.platform === "win32" ? "bb.cmd" : "bb";
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
    for (const entry of ["bb", "bb.cmd"]) {
      await copyFile(
        join(repoRoot, "apps", "cli", "bin", entry),
        join(fakeBinDir, entry),
      );
    }
    await chmod(join(fakeBinDir, "bb"), 0o755);
    return fakeRepoRoot;
  }

  async function writeFakePnpm(body: string): Promise<string> {
    const fakeBinDir = join(tempRoot, "fake-bin");
    await mkdir(fakeBinDir, { recursive: true });
    const fakePnpmPath = join(fakeBinDir, "pnpm");
    await writeFile(fakePnpmPath, `#!/usr/bin/env node\n${body}`, {
      mode: 0o755,
    });
    await chmod(fakePnpmPath, 0o755);
    if (process.platform === "win32") {
      await writeFile(join(fakeBinDir, "pnpm.cmd"), `@node "%~dp0pnpm" %*\n`);
    }
    return fakeBinDir;
  }

  async function runBin(
    fakeRepoRoot: string,
    args: string[],
    fakePnpmDir: string,
  ) {
    return execFileAsync(
      join(fakeRepoRoot, "apps", "cli", "bin", binEntryFileName()),
      args,
      {
        cwd: fakeRepoRoot,
        env: {
          ...process.env,
          PATH: `${fakePnpmDir}${delimiter}${process.env.PATH ?? ""}`,
        },
        shell: process.platform === "win32",
      },
    );
  }

  it("builds the source CLI before executing when dist is missing", async () => {
    const fakeRepoRoot = await createFakeRepo();
    const pnpmArgsPath = join(tempRoot, "pnpm-args.txt");
    const fakePnpmDir = await writeFakePnpm(`
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(pnpmArgsPath)}, args.join("\\n") + "\\n");
const repoRoot = args[args.indexOf("-C") + 1];
mkdirSync(join(repoRoot, "apps", "cli", "dist"), { recursive: true });
writeFileSync(
  join(repoRoot, "apps", "cli", "dist", "index.js"),
  "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));\\n",
);
`);

    const result = await runBin(fakeRepoRoot, ["status", "--json"], fakePnpmDir);

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
    const fakePnpmDir = await writeFakePnpm(`
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(pnpmCalledPath)}, "called\\n");
process.exit(42);
`);
    await mkdir(fakeDistDir, { recursive: true });
    await writeFile(
      join(fakeDistDir, "index.js"),
      "process.stdout.write(process.argv.slice(2).join(' '));\n",
    );

    const result = await runBin(fakeRepoRoot, ["--help"], fakePnpmDir);

    expect(result.stdout).toBe("--help");
    await expect(readFile(pnpmCalledPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
