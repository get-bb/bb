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
import { join } from "node:path";
import { promisify } from "node:util";
import ts from "typescript";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

it("cleans obsolete plugins and assets before restoring an older Turbo build", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-plugin-cache-"));
  try {
    const { config, error } = ts.parseConfigFileTextToJson(
      "turbo.json",
      await readFile(new URL("turbo.json", repoRoot), "utf8"),
    );
    expect(error).toBeUndefined();
    const serverConfig = JSON.parse(
      await readFile(new URL("apps/server/turbo.json", repoRoot), "utf8"),
    );
    const serverPackage = JSON.parse(
      await readFile(new URL("apps/server/package.json", repoRoot), "utf8"),
    );
    const serverRoot = join(root, "apps/server");
    await mkdir(serverRoot, { recursive: true });
    await mkdir(join(root, "packages/plugin-sdk"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "cache-fixture",
        private: true,
        packageManager: "pnpm@9.15.0",
      }),
    );
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n  - packages/*\n",
    );
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/server: {}\n  packages/plugin-sdk: {}\n",
    );
    await writeFile(join(root, ".gitignore"), "dist/\n.turbo/\n");
    await writeFile(
      join(root, "packages/plugin-sdk/package.json"),
      JSON.stringify({
        name: "@get-bb/plugin-sdk",
        scripts: { build: 'node -e ""' },
      }),
    );
    await writeFile(
      join(serverRoot, "package.json"),
      JSON.stringify({
        name: "@bb/server",
        scripts: {
          build:
            "node -e \"require('node:fs').mkdirSync('dist', { recursive: true })\"",
          "clean:plugins": serverPackage.scripts["clean:plugins"],
          "build:plugins": "node package.mjs",
        },
      }),
    );
    await writeFile(
      join(serverRoot, "package.mjs"),
      [
        'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
        'const version = readFileSync("version.txt", "utf8");',
        'const root = "dist/builtin-plugins";',
        "mkdirSync(`${root}/retained/dist`, { recursive: true });",
        "writeFileSync(`${root}/retained/dist/${version}.js`, version);",
        'if (version === "B") {',
        "  mkdirSync(`${root}/removed`, { recursive: true });",
        '  writeFileSync(`${root}/removed/package.json`, "{}");',
        "}",
        'console.log("PACKAGED " + version);',
      ].join("\n"),
    );
    await writeFile(
      join(root, "turbo.json"),
      JSON.stringify({
        tasks: {
          "@bb/server#build": {
            outputs: serverConfig.tasks.build.outputs,
          },
          "@get-bb/plugin-sdk#build": { outputs: [] },
          "@bb/server#clean:plugins": config.tasks["@bb/server#clean:plugins"],
          "@bb/server#build:plugins": {
            ...config.tasks["@bb/server#build:plugins"],
            inputs: ["version.txt", "package.mjs"],
          },
        },
      }),
    );
    await exec("git", ["init", "--quiet"], { cwd: root });
    const build = async (version) => {
      await writeFile(join(serverRoot, "version.txt"), version);
      const result = await exec(
        process.execPath,
        [
          require.resolve("turbo/bin/turbo"),
          "run",
          "build:plugins",
          "--filter=@bb/server",
          "--cache=local:rw",
          "--output-logs=errors-only",
        ],
        { cwd: root, env: { ...process.env, TURBO_DAEMON: "false" } },
      );
      return result.stdout;
    };
    await build("A");
    await build("B");
    expect(await readdir(join(serverRoot, "dist/builtin-plugins"))).toContain(
      "removed",
    );
    const restored = await build("A");
    expect(restored).toMatch(/3 cached, 4 total/);
    expect(await readdir(join(serverRoot, "dist/builtin-plugins"))).toEqual([
      "retained",
    ]);
    expect(
      await readdir(join(serverRoot, "dist/builtin-plugins/retained/dist")),
    ).toEqual(["A.js"]);
    expect(
      await readFile(
        join(serverRoot, "dist/builtin-plugins/retained/dist/A.js"),
        "utf8",
      ),
    ).toBe("A");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
