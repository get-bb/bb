import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { buildNodeEsmEntry } from "./build-utils.mjs";

const packageRoot = process.cwd();
const packageJsonPath = path.join(packageRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

function isString(value) {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sourceFromDistJs(distPath) {
  if (!isString(distPath)) {
    return undefined;
  }

  const sourcePath = distPath
    .replace(/^\.\/dist\//u, "./src/")
    .replace(/\.js$/u, ".ts");
  return sourcePath === distPath ? undefined : sourcePath;
}

function collectExportEntries() {
  if (!isObject(packageJson.exports)) {
    return [];
  }

  return Object.values(packageJson.exports).flatMap((exportValue) => {
    if (
      !exportValue ||
      !isObject(exportValue) ||
      Array.isArray(exportValue) ||
      !isString(exportValue.source) ||
      !isString(exportValue.import)
    ) {
      return [];
    }

    return [
      {
        entryPoint: path.resolve(packageRoot, exportValue.source),
        executable: false,
        format: "esm",
        outfile: path.resolve(packageRoot, exportValue.import),
      },
    ];
  });
}

function collectDefaultEntry() {
  if (packageJson.exports) {
    return [];
  }

  const entryPoint = path.join(packageRoot, "src", "index.ts");
  if (!existsSync(entryPoint)) {
    return [];
  }

  return [
    {
      entryPoint,
      executable: false,
      format: "esm",
      outfile: path.join(packageRoot, "dist", "index.js"),
    },
  ];
}

function collectBinEntries() {
  const rawBinEntries = isString(packageJson.bin)
    ? [[packageJson.name, packageJson.bin]]
    : Object.entries(packageJson.bin ?? {});

  return rawBinEntries.flatMap(([, binPath]) => {
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
        format: "esm",
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
  ...collectDefaultEntry(),
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
