import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isPathInsidePluginRoot } from "./plugin-manifest.js";

describe("isPathInsidePluginRoot", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("accepts a resolved relative entry inside the plugin directory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-inside-"));
    tempDirs.push(rootDir);
    expect(
      isPathInsidePluginRoot(rootDir, resolve(rootDir, "./src/server.ts")),
    ).toBe(true);
  });

  it("rejects a parent-relative escape", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "bb-plugin-escape-"));
    tempDirs.push(rootDir);
    expect(
      isPathInsidePluginRoot(rootDir, resolve(rootDir, "../evil.ts")),
    ).toBe(false);
  });
});
