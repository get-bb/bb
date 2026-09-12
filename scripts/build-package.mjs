import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { buildNodeEsmEntry } from "./build-utils.mjs";

const packageRoot = process.cwd();
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function sourceFromDistJs(distPath) {
  if (typeof distPath !== "string") {
    return undefined;
  }

  const sourcePath = distPath
    .replace(/^\.\/dist\//u, "./src/")
    .replace(/\.js$/u, ".ts");
  return sourcePath === distPath ? undefined : sourcePath;
}

function collectExportEntries() {
  if (!packageJson.exports || typeof packageJson.exports !== "object") {
    return [];
  }

  return Object.values(packageJson.exports).flatMap((exportValue) => {
    if (
      !exportValue ||
      typeof exportValue !== "object" ||
      Array.isArray(exportValue) ||
      typeof exportValue.source !== "string" ||
      typeof exportValue.import !== "string"
    ) {
      return [];
    }

    return [
      {
        entryPoint: path.resolve(packageRoot, exportValue.source),
        executable: false,
        outfile: path.resolve(packageRoot, exportValue.import),
      },
    ];
  });
}

function collectBinEntries() {
  return Object.entries(packageJson.bin ?? {}).flatMap(([, binPath]) => {
    const sourcePath = sourceFromDistJs(binPath);
    if (!sourcePath) {
      return [];
    }

    const entryPoint = path.resolve(packageRoot, sourcePath);
    if (!existsSync(entryPoint)) {
      return [];
    }

    return [
      {
        entryPoint,
        executable: true,
        outfile: path.resolve(packageRoot, binPath),
      },
    ];
  });
}

function dedupeEntries(entries) {
  const byOutfile = new Map();
  for (const entry of entries) {
    byOutfile.set(entry.outfile, entry);
  }
  return [...byOutfile.values()];
}

const entries = dedupeEntries([
  ...collectExportEntries(),
  ...collectBinEntries(),
]);

if (entries.length === 0) {
  process.stdout.write(`${packageJson.name}: no build entries\n`);
  process.exit(0);
}

await rm(path.join(packageRoot, "dist"), { force: true, recursive: true });

for (const entry of entries) {
  await buildNodeEsmEntry({ ...entry, cleanDist: false, packageRoot });
}

process.stdout.write(`${packageJson.name}: built ${entries.length} entries\n`);
