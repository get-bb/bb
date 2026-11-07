import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const CODE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"]);

let pending: Promise<string> | undefined;

async function digestCode(directory: string): Promise<string> {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  const files = entries
    .filter(
      (entry) => entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name)),
    )
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split(sep).includes("node_modules"))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(join(directory, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function pluginBuildCodeDigest(): Promise<string> {
  pending ??= digestCode(dirname(fileURLToPath(import.meta.url))).catch(
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}
