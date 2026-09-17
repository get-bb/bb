import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPluginHost } from "./build-plugin-host.js";
import { buildPluginServer } from "./build-plugin-server.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const SOURCE_FILES = ["package.json", "server.ts", "contract.ts", "host.ts"];

async function stagePluginCopy(root: string): Promise<void> {
  const source = join(repositoryRoot, "plugins", "keep-awake");
  for (const fileName of SOURCE_FILES) {
    await cp(join(source, fileName), join(root, fileName));
  }
  await symlink(
    join(source, "node_modules"),
    join(root, "node_modules"),
    "junction",
  );
}

describe("plugin artifact digest determinism", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function twoStagedRoots(): Promise<[string, string]> {
    const first = await mkdtemp(join(repositoryRoot, ".artifact-digest-test-"));
    const second = await mkdtemp(
      join(repositoryRoot, ".artifact-digest-test-"),
    );
    tempDirs.push(first, second);
    await stagePluginCopy(first);
    await stagePluginCopy(second);
    return [first, second];
  }

  it("derives the same host digest from equivalent staging directories", async () => {
    const [first, second] = await twoStagedRoots();
    const toolchain = await resolvePluginBuildToolchain(
      join(repositoryRoot, "node_modules", ".unused-toolchain"),
    );
    const [a, b] = await Promise.all([
      buildPluginHost(first, "0.9.0-test", toolchain),
      buildPluginHost(second, "0.9.0-test", toolchain),
    ]);
    expect(a.artifactDigest).toBe(b.artifactDigest);
  }, 90_000);

  it("derives the same server bytes from equivalent staging directories", async () => {
    const [first, second] = await twoStagedRoots();
    const toolchain = await resolvePluginBuildToolchain(
      join(repositoryRoot, "node_modules", ".unused-toolchain"),
    );
    const [a, b] = await Promise.all([
      buildPluginServer(first, "0.9.0-test", toolchain),
      buildPluginServer(second, "0.9.0-test", toolchain),
    ]);
    const [bytesA, bytesB] = await Promise.all([
      readFile(a.jsPath),
      readFile(b.jsPath),
    ]);
    expect(bytesA.equals(bytesB)).toBe(true);
  }, 90_000);
});
