import { chmod, cp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "var __filename = __fileURLToPath(import.meta.url);",
  "var __dirname = __pathDirname(__filename);",
].join("\n");

const NATIVE_EXTERNAL_PACKAGES = [
  "@parcel/watcher",
  "better-sqlite3",
  "bufferutil",
  "fsevents",
  "node-pty",
  "pino",
  "pino-pretty",
  "pino-roll",
  "thread-stream",
  "utf-8-validate",
  // jiti loads plugin server entries as TypeScript at runtime and lazily
  // require()s its own transform files (babel.cjs); bundling it breaks that
  // lazy resolution, so it must stay external + a shipped dependency unless a
  // bundle target explicitly uses the bundle-safe `jiti/static` entry point.
  "jiti",
];

export function externalPackagePatterns(packageNames) {
  return packageNames.flatMap((packageName) => [
    packageName,
    `${packageName}/*`,
  ]);
}

export function createNativeExternalPatterns({ bundledPackages = [] } = {}) {
  const bundledPackageSet = new Set(bundledPackages);
  return externalPackagePatterns(
    NATIVE_EXTERNAL_PACKAGES.filter(
      (packageName) => !bundledPackageSet.has(packageName),
    ),
  );
}

async function removeFileAndMap(outfile) {
  await Promise.all([
    rm(outfile, { force: true }),
    rm(`${outfile}.map`, { force: true }),
  ]);
}

export async function copyDirectory({ from, to }) {
  await rm(to, { force: true, recursive: true });
  await cp(from, to, { recursive: true });
}

/**
 * Code-split output for an entry that `import()`s parts of itself lazily.
 *
 * A single-file bundle makes every `import()` target an esbuild lazy wrapper
 * inside the one script: V8 still pre-parses all of it on every start, and
 * the wrappers that do run are parsed a second time when first called, so a
 * command that uses most of the bundle gets slower, not faster. With
 * `splitting`, each lazily imported subtree lands in its own chunk file next
 * to the entry and Node reads and compiles only the chunks a command needs.
 *
 * esbuild's split mode writes `<entryNames>.js` into `outdir`. The entry
 * keeps `outfile`'s directory and name; an extensionless `outfile` (the
 * packaged `bb` executable) is renamed into place by
 * {@link finalizeSplitOutput}, which is safe because chunks are imported by
 * a relative path from the same directory. Chunks go under a sibling
 * directory so packaging can list it next to the entry.
 */
export function splitOutputOptions(outfile) {
  const baseName = path.basename(outfile);
  const entryName = baseName.endsWith(".js") ? baseName.slice(0, -3) : baseName;
  return {
    chunkDir: path.join(path.dirname(outfile), `${entryName}-chunks`),
    esbuild: {
      chunkNames: `${entryName}-chunks/[name]-[hash]`,
      entryNames: entryName,
      outdir: path.dirname(outfile),
      splitting: true,
    },
    /** Where esbuild writes the entry; differs from `outfile` only when extensionless. */
    writtenEntry: path.join(path.dirname(outfile), `${entryName}.js`),
  };
}

export async function finalizeSplitOutput(outfile) {
  const { writtenEntry } = splitOutputOptions(outfile);
  if (writtenEntry !== outfile) {
    await rename(writtenEntry, outfile);
  }
}

export async function buildNodeEsmEntry({
  cleanDist,
  entryPoint,
  executable = false,
  external = [],
  outfile,
  packageRoot,
  sourcemap = true,
  splitting = false,
  target = "node22",
}) {
  const split = splitting ? splitOutputOptions(outfile) : null;
  if (cleanDist) {
    await rm(path.join(packageRoot, "dist"), { force: true, recursive: true });
  } else {
    await removeFileAndMap(outfile);
    if (split) {
      // Chunk names carry content hashes, so a rebuild would otherwise leave
      // the previous build's chunks behind.
      await rm(split.chunkDir, { force: true, recursive: true });
    }
  }

  await build({
    banner: {
      js: NODE_ESM_REQUIRE_BANNER,
    },
    bundle: true,
    conditions: ["source"],
    entryPoints: [entryPoint],
    external: [...createNativeExternalPatterns(), ...external],
    format: "esm",
    legalComments: "none",
    ...(split ? split.esbuild : { outfile }),
    platform: "node",
    sourcemap,
    target,
  });

  if (split) {
    await finalizeSplitOutput(outfile);
  }
  if (executable) {
    await chmod(outfile, 0o755);
  }
}
