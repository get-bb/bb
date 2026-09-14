import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";
import { resolvePackagedAppBinary } from "./packaged-app-paths.mjs";

const run = promisify(execFile);

async function hashPackagedResources(resources) {
  const hash = createHash("sha256");
  async function visit(file) {
    const stat = await lstat(file);
    hash.update(JSON.stringify([file, stat.mode]));
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort())
        await visit(join(file, name));
    } else {
      hash.update(
        stat.isSymbolicLink() ? await readlink(file) : await readFile(file),
      );
    }
  }
  await visit(join(resources, "app.asar"));
  await visit(join(resources, "app.asar.unpacked"));
  return hash.digest("hex");
}

async function auditDependencies(modulesRoot) {
  const { createRequire } = await import("node:module");
  const { readdir, readFile, realpath } = await import("node:fs/promises");
  const { dirname, join, sep } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const assert = (await import("node:assert/strict")).default;
  assert.ok(process.versions.electron, "npm must run through bundled Electron");
  const root = await realpath(modulesRoot);
  async function insideArtifact(file) {
    const resolved = await realpath(file);
    assert.ok(
      resolved.startsWith(root + sep),
      `Dependency escaped artifact: ${resolved}`,
    );
    return resolved;
  }
  const fromApp = createRequire(join(root, "bb-app", "package.json"));
  const manifestPath = await insideArtifact(
    fromApp.resolve("npm/package.json"),
  );
  const npmRoot = dirname(manifestPath);
  const npm = JSON.parse(await readFile(manifestPath, "utf8"));
  const fromNpm = createRequire(manifestPath);
  const semver = fromNpm(await insideArtifact(fromNpm.resolve("semver")));
  const resolvedVersions = new Map();
  async function dependencyVersion(entry, name) {
    const key = `${entry}:${name}`;
    if (resolvedVersions.has(key)) return resolvedVersions.get(key);
    let directory = dirname(entry);
    while (directory.startsWith(root + sep)) {
      const manifest = await readFile(
        join(directory, "package.json"),
        "utf8",
      ).catch((error) => {
        if (error.code === "ENOENT") return "null";
        throw error;
      });
      const parsed = JSON.parse(manifest);
      if (parsed?.name === name) {
        resolvedVersions.set(key, parsed.version);
        return parsed.version;
      }
      directory = dirname(directory);
    }
    throw new Error(`No packaged manifest for ${name} at ${entry}`);
  }
  let packages = 0;
  let resolutions = 0;
  async function auditPackage(packageRoot) {
    const manifestPath = join(packageRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const require = createRequire(manifestPath);
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (name in (manifest.optionalDependencies ?? {})) continue;
      const cjs = await insideArtifact(require.resolve(name));
      const esm = await insideArtifact(
        fileURLToPath(
          import.meta.resolve(name, pathToFileURL(manifestPath).href),
        ),
      );
      for (const entry of new Set([cjs, esm])) {
        const version = await dependencyVersion(entry, name);
        assert.ok(
          semver.satisfies(version, range),
          `${manifest.name} requires ${name}@${range}, resolved ${version} at ${entry}`,
        );
      }
      resolutions++;
    }
    packages++;
    const nested = join(packageRoot, "node_modules");
    const entries = await readdir(nested, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      assert.ok(
        entry.isDirectory(),
        `Unexpected bundled dependency link: ${entry.name}`,
      );
      const child = join(nested, entry.name);
      if (entry.name.startsWith("@")) {
        for (const name of await readdir(child))
          await auditPackage(join(child, name));
      } else {
        await auditPackage(child);
      }
    }
  }
  await auditPackage(npmRoot);
  const chalkUrl = import.meta.resolve(
    "chalk",
    pathToFileURL(manifestPath).href,
  );
  const chalk = await import(chalkUrl);
  assert.equal(typeof chalk.default, "function");
  await import(pathToFileURL(join(npmRoot, "lib", "utils", "display.js")).href);
  console.log(
    JSON.stringify({
      npmCli: join(npmRoot, "bin", "npm-cli.js"),
      version: npm.version,
      directDependencies: Object.keys(npm.dependencies).length,
      packages,
      resolutions,
      electron: process.versions.electron,
      node: process.versions.node,
    }),
  );
}

export async function smokePackagedNpm(appBinary) {
  appBinary = resolve(appBinary);
  const resources =
    process.platform === "darwin"
      ? resolve(dirname(appBinary), "..", "Resources")
      : join(dirname(appBinary), "resources");
  const fixture = await realpath(
    await mkdtemp(join(tmpdir(), "bb-packaged-npm-smoke-")),
  );
  try {
    const resourcesBefore = await hashPackagedResources(resources);
    const plugin = join(fixture, "plugin");
    const dependency = join(fixture, "dependency");
    await mkdir(plugin);
    await mkdir(dependency);
    const options = {
      cwd: fixture,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        PATH: "",
        HOME: fixture,
        TMPDIR: fixture,
        npm_config_cache: join(fixture, "cache"),
        npm_config_userconfig: join(fixture, "user-npmrc"),
        npm_config_globalconfig: join(fixture, "global-npmrc"),
        npm_config_update_notifier: "false",
        npm_config_offline: "true",
      },
    };
    const auditScript = join(fixture, "audit-dependencies.mjs");
    await writeFile(
      auditScript,
      `await (${auditDependencies.toString()})(${JSON.stringify(join(resources, "app.asar.unpacked", "node_modules"))});\n`,
    );
    const audit = await run(
      appBinary,
      ["--experimental-import-meta-resolve", auditScript],
      options,
    );
    const result = JSON.parse(audit.stdout);
    assert.equal(typeof result.npmCli, "string");
    assert.equal(typeof result.version, "string");
    const npm = (...args) => run(appBinary, [result.npmCli, ...args], options);
    assert.equal((await npm("--version")).stdout.trim(), result.version);
    for (const version of ["1.0.0", "2.0.0"]) {
      await writeFile(
        join(dependency, "package.json"),
        JSON.stringify({
          name: "bb-smoke-dependency",
          version,
          type: "module",
          exports: "./index.js",
          scripts: { preinstall: "exit 42", postinstall: "exit 42" },
        }),
      );
      await writeFile(
        join(dependency, "index.js"),
        `export default ${JSON.stringify(version)};\n`,
      );
      await npm(
        "pack",
        dependency,
        "--pack-destination",
        fixture,
        "--ignore-scripts",
      );
      await writeFile(
        join(plugin, "package.json"),
        JSON.stringify({
          name: "bb-plugin-packaged-npm-smoke",
          version,
          type: "module",
          bb: {
            name: "Packaged npm smoke",
            description: "Disposable desktop dependency install fixture",
            branding: { icon: "Zap" },
            server: "./server.js",
          },
          dependencies: {
            "bb-smoke-dependency": `file:../bb-smoke-dependency-${version}.tgz`,
          },
          scripts: { preinstall: "exit 42", postinstall: "exit 42" },
        }),
      );
      await writeFile(
        join(plugin, "server.js"),
        'export { default as dependencyVersion } from "bb-smoke-dependency";\nexport default function plugin() {}\n',
      );
      await npm(
        "install",
        "--prefix",
        plugin,
        "--ignore-scripts",
        "--omit=dev",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
      );
      const probe = await run(
        appBinary,
        [
          "--input-type=module",
          "--eval",
          `import { dependencyVersion } from ${JSON.stringify(pathToFileURL(join(plugin, "server.js")).href)}; console.log(dependencyVersion);`,
        ],
        options,
      );
      assert.equal(probe.stdout.trim(), version);
      const lock = JSON.parse(
        await readFile(join(plugin, "package-lock.json"), "utf8"),
      );
      assert.ok(
        lock.packages["node_modules/bb-smoke-dependency"],
        JSON.stringify(lock),
      );
      assert.equal(
        lock.packages["node_modules/bb-smoke-dependency"].version,
        version,
      );
    }
    assert.equal(
      await hashPackagedResources(resources),
      resourcesBefore,
      "Plugin dependency install/update modified packaged resources",
    );
    console.log(
      `Packaged npm ${result.version}: ${result.directDependencies} direct dependencies, ${result.packages} bundled packages, ${result.resolutions} CJS/ESM dependency edges; offline plugin dependency install/update passed with Electron ${result.electron} (Node ${result.node}) and empty PATH; packaged resources unchanged.`,
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const releaseConfig = createDesktopReleaseConfig(
    resolveDesktopReleaseChannel(process.env),
  );
  const appBinary =
    process.argv[2] ??
    (await resolvePackagedAppBinary({
      executableName: releaseConfig.linuxExecutableName,
      platform: process.platform,
      productName: releaseConfig.applicationName,
      releaseDir: resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "release",
      ),
    }));
  await smokePackagedNpm(appBinary);
}
