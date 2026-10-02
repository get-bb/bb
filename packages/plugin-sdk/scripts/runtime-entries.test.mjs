import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runtimeBuildOptions, runtimeEntries } from "./runtime-entries.mjs";

const run = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const {
  exports: packageExports,
  dependencies,
  peerDependencies,
} = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const libraryEntries = runtimeEntries(packageExports).filter(
  (entry) => entry.subpath !== undefined,
);

describe("published runtime entries", () => {
  let outDir;
  const outputs = new Map();

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(packageRoot, ".runtime-test-"));
    for (const entry of libraryEntries) {
      const outfile = path.join(outDir, path.relative("dist", entry.output));
      await build({
        ...runtimeBuildOptions(packageRoot, entry, outfile),
        logLevel: "silent",
      });
      outputs.set(entry.subpath, outfile);
    }
  }, 120_000);

  afterAll(async () => {
    if (outDir) await rm(outDir, { force: true, recursive: true });
  });

  it("inline no CommonJS module that would need a require shim", async () => {
    const shimmed = [];
    for (const [subpath, outfile] of outputs) {
      if ((await readFile(outfile, "utf8")).includes("Dynamic require of")) {
        shimmed.push(subpath);
      }
    }

    expect(shimmed).toEqual([]);
  });

  it("declare the packages they leave external as dependencies", () => {
    const externals = new Set(
      libraryEntries
        .flatMap((entry) => entry.external)
        .filter((name) => !name.endsWith("/*")),
    );

    expect(
      [...externals].filter(
        (name) =>
          dependencies[name] === undefined &&
          peerDependencies[name] === undefined,
      ),
    ).toEqual([]);
  });

  it.each(["./host", "./provider-bridge"])(
    "%s imports under plain Node, as a plugin's own tests load it",
    async (subpath) => {
      const { stdout } = await run(process.execPath, [
        "--input-type=module",
        "-e",
        "const mod = await import(process.argv[1]); console.log(Object.keys(mod).length > 0);",
        pathToFileURL(outputs.get(subpath)).href,
      ]);

      expect(stdout.trim()).toBe("true");
    },
  );
});
