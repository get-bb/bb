import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function smokePackagedNpm(appBinary) {
  const resourcesDir =
    process.platform === "darwin"
      ? join(dirname(appBinary), "..", "Resources")
      : join(dirname(appBinary), "resources");
  const requireFromApp = createRequire(
    join(
      resourcesDir,
      "app.asar.unpacked",
      "node_modules",
      "bb-app",
      "package.json",
    ),
  );
  const npmManifest = requireFromApp.resolve("npm/package.json");
  const npmCli = join(dirname(npmManifest), "bin", "npm-cli.js");
  const { version } = JSON.parse(await readFile(npmManifest, "utf8"));
  const fixture = await mkdtemp(join(tmpdir(), "bb-packaged-npm-smoke-"));
  try {
    const project = join(fixture, "project");
    const dependency = join(fixture, "dependency");
    await mkdir(project);
    await mkdir(dependency);
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({
        name: "bb-smoke-dependency",
        version: "1.0.0",
        main: "index.js",
      }),
    );
    await writeFile(
      join(dependency, "index.js"),
      'module.exports = "packaged npm works";\n',
    );
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "bb-packaged-npm-smoke",
        version: "1.0.0",
        private: true,
        dependencies: { "bb-smoke-dependency": "file:../dependency" },
        scripts: { preinstall: "exit 42" },
      }),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^npm_/i.test(key) && key !== "NODE_OPTIONS" && key !== "NODE_PATH",
      ),
    );
    const options = {
      cwd: project,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
        PATH: "",
        npm_config_cache: join(fixture, "cache"),
        npm_config_userconfig: join(fixture, "user-npmrc"),
        npm_config_globalconfig: join(fixture, "global-npmrc"),
        npm_config_update_notifier: "false",
      },
    };
    const result = await run(appBinary, [npmCli, "--version"], options);
    assert.equal(result.stdout.trim(), version);
    await run(
      appBinary,
      [
        npmCli,
        "install",
        "--offline",
        "--install-links",
        "--ignore-scripts",
        "--omit=dev",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
      ],
      options,
    );
    const requireFromProject = createRequire(join(project, "package.json"));
    assert.equal(
      requireFromProject("bb-smoke-dependency"),
      "packaged npm works",
    );
    console.log(
      `Packaged npm ${version} installed a dependency with an empty PATH.`,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
