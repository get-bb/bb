import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import {
  resolveSkillCatalogEntries,
  SkillTreeRegistry,
} from "../../src/services/skills/injected-skills.js";
import type { ServerLogger } from "../../src/types.js";

const logger: ServerLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

async function createCatalog() {
  const dataDir = await makeTempDir();
  const rootPath = path.join(dataDir, "skills", "cache-example");
  fs.mkdirSync(path.join(rootPath, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "SKILL.md"),
    "---\nname: cache-example\ndescription: Original description\n---\n# Example\n",
  );
  const referencePath = path.join(rootPath, "references", "example.txt");
  fs.writeFileSync(referencePath, "original\n");
  fs.utimesSync(referencePath, 100, 100);
  const skillTreeRegistry = new SkillTreeRegistry();
  return {
    rootPath,
    referencePath,
    resolve: () =>
      resolveSkillCatalogEntries(logger, { dataDir, skillTreeRegistry }),
  };
}

async function freshTreeHash(rootPath: string): Promise<string> {
  return (await new SkillTreeRegistry().readTree(rootPath)).treeHash;
}

async function withSettledFiles<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 10_000);
  try {
    return await run();
  } finally {
    vi.useRealTimers();
  }
}

describe("skill catalog freshness", () => {
  it("reuses settled unchanged files without rereading their contents", async () => {
    const catalog = await createCatalog();
    const reads = vi.spyOn(fs, "createReadStream");
    try {
      const first = await withSettledFiles(catalog.resolve);
      expect(first).toHaveLength(1);
      expect(reads).toHaveBeenCalledTimes(2);
      reads.mockClear();
      expect(await catalog.resolve()).toEqual(first);
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
    }
  });

  it("rereads files changed too recently to trust their timestamps", async () => {
    const catalog = await createCatalog();
    const first = await catalog.resolve();
    const reads = vi.spyOn(fs, "createReadStream");
    try {
      expect(await catalog.resolve()).toEqual(first);
      expect(reads).toHaveBeenCalledTimes(2);
    } finally {
      reads.mockRestore();
    }
  });

  it.each([
    "content",
    "replacement",
    "rename",
    ...(process.platform === "win32" ? [] : ["mode"]),
    "addition",
    "removal",
  ])("rehashes settled files after a %s change", async (change) => {
    const catalog = await createCatalog();
    const [first] = await withSettledFiles(catalog.resolve);
    const otherPath = path.join(catalog.rootPath, "references", "other.txt");
    if (change === "content") {
      fs.writeFileSync(catalog.referencePath, "modified content\n");
      fs.utimesSync(catalog.referencePath, 100, 100);
    } else if (change === "replacement") {
      fs.writeFileSync(otherPath, "modified\n");
      fs.utimesSync(otherPath, 100, 100);
      fs.renameSync(otherPath, catalog.referencePath);
    } else if (change === "rename") {
      fs.renameSync(catalog.referencePath, otherPath);
    } else if (change === "mode") {
      fs.chmodSync(catalog.referencePath, 0o700);
    } else if (change === "addition") {
      fs.writeFileSync(otherPath, "new\n");
    } else {
      fs.rmSync(catalog.referencePath);
    }
    const [updated] = await catalog.resolve();
    expect(updated?.runtimeSource).not.toEqual(first?.runtimeSource);
    expect(updated?.runtimeSource).toMatchObject({
      treeHash: await freshTreeHash(catalog.rootPath),
    });
  });
});
