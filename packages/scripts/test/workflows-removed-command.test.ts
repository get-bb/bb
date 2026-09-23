import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const DOCUMENTATION_EXTENSIONS = new Set([
  ".cjs",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);
const IGNORED_DIRECTORIES = new Set(["coverage", "dist", "node_modules"]);

function readIfPresent(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function documentationFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];
  for (let directory = pending.pop(); directory; directory = pending.pop()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith(".") &&
          !IGNORED_DIRECTORIES.has(entry.name)
        ) {
          pending.push(path);
        }
      } else if (
        entry.isFile() &&
        DOCUMENTATION_EXTENSIONS.has(extname(entry.name))
      ) {
        files.push(path);
      }
    }
  }
  return files;
}

it("keeps the removed workflow-specific catalog command out of project documentation", () => {
  const removedCommand = ["bb workflows", "catalog"].join(" ");
  const matches = documentationFiles(repoRoot)
    .filter((path) => readIfPresent(path).includes(removedCommand))
    .map((path) => relative(repoRoot, path))
    .sort();
  expect(matches).toEqual([]);
});
