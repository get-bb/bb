import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { describe, expect, it, vi } from "vitest";
import {
  readSkillTreeManifest,
  resolveSkillCatalogEntries,
  SkillTreeRegistry,
} from "../../src/services/skills/injected-skills.js";
import type { ServerLogger } from "../../src/types.js";

async function createCatalog() {
  const temp = await makeTempDir();
  const rootPath = path.join(temp, "skills", "cache-example");
  fs.mkdirSync(path.join(rootPath, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(rootPath, "SKILL.md"),
    "---\nname: cache-example\ndescription: Original description\n---\n# Example\n",
  );
  const referencePath = path.join(rootPath, "references", "example.txt");
  fs.writeFileSync(referencePath, "original\n");
  fs.utimesSync(referencePath, 100, 100);
  const logger: ServerLogger = {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  };
  const skillTreeRegistry = new SkillTreeRegistry();
  return {
    rootPath,
    referencePath,
    resolve: () =>
      resolveSkillCatalogEntries(logger, {
        dataDir: temp,
        skillTreeRegistry,
      }),
  };
}

describe("skill catalog freshness", () => {
  it("reuses an unchanged tree without reading any file contents", async () => {
    const catalog = await createCatalog();
    const reads = vi.spyOn(fs, "readFileSync");
    try {
      const first = catalog.resolve();
      expect(first).toHaveLength(1);
      expect(reads.mock.calls.length).toBeGreaterThan(0);
      reads.mockClear();
      expect(catalog.resolve()).toEqual(first);
      expect(reads).not.toHaveBeenCalled();
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
  ])("invalidates cached hashes after a file %s change", async (change) => {
    const catalog = await createCatalog();
    const first = catalog.resolve();
    if (change === "content" || change === "replacement") {
      if (change === "replacement") {
        fs.renameSync(
          catalog.referencePath,
          path.join(catalog.rootPath, "references", "old.txt"),
        );
      }
      fs.writeFileSync(catalog.referencePath, "modified\n");
      fs.utimesSync(catalog.referencePath, 100, 100);
      if (change === "replacement") {
        fs.rmSync(path.join(catalog.rootPath, "references", "old.txt"));
      }
    } else if (change === "rename") {
      fs.renameSync(
        catalog.referencePath,
        path.join(catalog.rootPath, "references", "renamed.txt"),
      );
    } else if (change === "mode") {
      fs.chmodSync(catalog.referencePath, 0o700);
    } else if (change === "addition") {
      fs.writeFileSync(path.join(catalog.rootPath, "added.txt"), "new\n");
    } else {
      fs.rmSync(catalog.referencePath);
    }
    const updated = catalog.resolve();
    expect(updated).toHaveLength(1);
    expect(updated).not.toEqual(first);
    expect(updated[0]?.runtimeSource).toMatchObject({
      treeHash: readSkillTreeManifest(catalog.rootPath).treeHash,
    });
  });

  it("retries a failed rebuild instead of reusing a stale candidate", async () => {
    const catalog = await createCatalog();
    catalog.resolve();
    fs.writeFileSync(catalog.referencePath, "changed\n");
    const reads = vi.spyOn(fs, "readFileSync");
    reads.mockImplementationOnce(() => {
      throw new Error("Temporary read failure");
    });
    try {
      expect(catalog.resolve()).toEqual([]);
    } finally {
      reads.mockRestore();
    }
    expect(catalog.resolve()[0]?.runtimeSource).toMatchObject({
      treeHash: readSkillTreeManifest(catalog.rootPath).treeHash,
    });
  });

  it("refreshes frontmatter and rejects invalid trees after caching", async () => {
    const catalog = await createCatalog();
    catalog.resolve();
    fs.writeFileSync(
      path.join(catalog.rootPath, "SKILL.md"),
      "---\nname: cache-example\ndescription: Updated description\n---\n",
    );
    expect(catalog.resolve()[0]?.runtimeSource.description).toBe(
      "Updated description",
    );
    fs.rmSync(catalog.referencePath);
    fs.symlinkSync("missing.txt", catalog.referencePath);
    expect(catalog.resolve()).toEqual([]);
    fs.rmSync(catalog.referencePath);
    fs.writeFileSync(catalog.referencePath, "recovered\n");
    expect(catalog.resolve()[0]?.runtimeSource).toMatchObject({
      treeHash: readSkillTreeManifest(catalog.rootPath).treeHash,
    });
    fs.rmSync(catalog.rootPath, { recursive: true });
    expect(catalog.resolve()).toEqual([]);
  });
});
