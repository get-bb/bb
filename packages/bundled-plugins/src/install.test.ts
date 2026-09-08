import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { installBundledPlugins } from "./install.js";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);

it("restores cached archives without retaining deleted plugins or assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-plugin-cache-"));
  try {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "cache-fixture",
        private: true,
        packageManager: "pnpm@9.15.0",
      }),
    );
    await writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      "packages:\n  - plugins/*\n",
    );
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  plugins/fixture: {}\n",
    );
    await writeFile(
      path.join(root, ".gitignore"),
      "dist/\n.turbo/\nruntime/\n",
    );
    await writeFile(
      path.join(root, "turbo.json"),
      JSON.stringify({
        tasks: { build: { outputs: ["dist/bundled-plugins.tar"] } },
      }),
    );
    const pluginRoot = path.join(root, "plugins/fixture");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(
      path.join(pluginRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { build: "node build.cjs" } }),
    );
    await writeFile(
      path.join(pluginRoot, "build.cjs"),
      [
        'const { mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");',
        `const { create } = require(${JSON.stringify(require.resolve("tar"))});`,
        'const version = readFileSync("version.txt", "utf8");',
        'rmSync("dist", { recursive: true, force: true });',
        'mkdirSync("dist/staging/retained/dist", { recursive: true });',
        "writeFileSync(`dist/staging/retained/dist/${version}.js`, version);",
        'if (version === "B") {',
        '  mkdirSync("dist/staging/removed", { recursive: true });',
        '  writeFileSync("dist/staging/removed/package.json", "{}");',
        "}",
        'create({ cwd: "dist/staging", file: "dist/bundled-plugins.tar", portable: true, mtime: new Date(0) }, ["."]).catch(error => { console.error(error); process.exitCode = 1; });',
      ].join("\n"),
    );
    await exec("git", ["init", "--quiet"], { cwd: root });
    const archive = path.join(pluginRoot, "dist/bundled-plugins.tar");
    const target = path.join(root, "runtime");
    const build = async (version: string) => {
      await writeFile(path.join(pluginRoot, "version.txt"), version);
      const { stdout } = await exec(
        process.execPath,
        [
          require.resolve("turbo/bin/turbo"),
          "run",
          "build",
          "--filter=fixture",
          "--cache=local:rw",
          "--output-logs=errors-only",
        ],
        { cwd: root },
      );
      await installBundledPlugins(archive, target);
      return stdout;
    };
    await build("A");
    const originalArchive = await readFile(archive);
    await build("B");
    expect(await readdir(target)).toContain("removed");
    expect(await build("A")).toMatch(/1 cached, 1 total/);
    expect(await readFile(archive)).toEqual(originalArchive);
    expect(await readdir(target)).toEqual(["retained"]);
    expect(await readdir(path.join(target, "retained/dist"))).toEqual(["A.js"]);
    expect(
      await readFile(path.join(target, "retained/dist/A.js"), "utf8"),
    ).toBe("A");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("keeps the installed collection when the replacement archive cannot be read", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-plugin-install-"));
  try {
    const target = path.join(root, "runtime");
    await mkdir(target);
    await writeFile(path.join(target, "existing.js"), "existing");
    const archive = path.join(root, "broken.tar");
    await writeFile(archive, "invalid archive");
    await expect(installBundledPlugins(archive, target)).rejects.toThrow();
    expect(await readFile(path.join(target, "existing.js"), "utf8")).toBe(
      "existing",
    );
    expect((await readdir(root)).sort()).toEqual(["broken.tar", "runtime"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
