import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { cachedReactCompiler } from "../vite-react-compiler.js";

const fixtures: string[] = [];
const source = `import React from "react";
export function Counter({ count }) { return <span>{count + 1}</span>; }`;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bb-compiler-cache-"));
  fixtures.push(root);
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(root, "entry.jsx"), source);
  return root;
}

async function compile(root: string, mode = "production") {
  await build({
    root,
    mode,
    configFile: false,
    plugins: [cachedReactCompiler()],
    cacheDir: join(root, "cache"),
    logLevel: "silent",
    build: {
      lib: {
        entry: join(root, "entry.jsx"),
        formats: ["es"],
        fileName: "fixture",
      },
      minify: false,
      sourcemap: true,
      rolldownOptions: { external: /^react($|\/)/ },
    },
  });
  return Promise.all([
    readFile(join(root, "dist/fixture.js"), "utf8"),
    readFile(join(root, "dist/fixture.js.map"), "utf8"),
  ]);
}

afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("React Compiler build cache", () => {
  it("reuses compiled code and source maps, and invalidates changed source and modes", async () => {
    const root = await fixture();
    const cold = await compile(root);
    expect(cold[0]).toContain("react/compiler-runtime");
    const cacheDir = join(root, "cache/react-compiler");
    const files = await readdir(cacheDir);
    expect(files).toHaveLength(1);
    const cacheFile = join(cacheDir, files[0]);
    const oldTime = new Date("2000-01-01T00:00:00Z");
    await utimes(cacheFile, oldTime, oldTime);
    expect(await compile(root)).toEqual(cold);
    expect((await stat(cacheFile)).mtimeMs).toBe(oldTime.getTime());

    await writeFile(
      join(root, "entry.jsx"),
      source.replace("count + 1", "count + 2"),
    );
    expect(await compile(root)).not.toEqual(cold);
    expect(await readdir(cacheDir)).toHaveLength(2);
    await compile(root, "staging");
    expect(await readdir(cacheDir)).toHaveLength(3);
  });

  it("rebuilds truncated or invalid cached transforms", async () => {
    const root = await fixture();
    const cold = await compile(root);
    const cacheDir = join(root, "cache/react-compiler");
    const [file] = await readdir(cacheDir);
    const cacheFile = join(cacheDir, file);
    for (const invalid of ['{"code":', '{"code":"wrong","map":"broken"}']) {
      await writeFile(cacheFile, invalid);
      expect(await compile(root)).toEqual(cold);
      expect(await readFile(cacheFile, "utf8")).not.toEqual(invalid);
    }
  });

  it("still compiles when the cache directory is unavailable", async () => {
    const root = await fixture();
    await writeFile(join(root, "cache"), "not a directory");
    const output = await compile(root);
    expect(output[0]).toContain("react/compiler-runtime");
  });
});
