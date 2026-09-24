#!/usr/bin/env node
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SHIMMED_TYPE_PACKAGES } from "../packages/plugin-build/src/runtime-shims.mjs";
import {
  forkPluginPackageJson,
  forkPluginTsconfig,
  registryAliasImports,
  registryItemsForImports,
  registryPackages,
} from "./lib/plugin-fork.mjs";

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE =
  "Usage: node scripts/check-plugin-forks.mjs [plugins/<name> ...] [--keep] [--concurrency=<n>]\n\n" +
  "Copies each forkable built-in plugin (scripts/forkable-plugins.json) out of\n" +
  "the monorepo the way a fork would: the component registry items its @/\n" +
  "imports name are written into the copy, and it installs published packages\n" +
  "plus a packed @get-bb/plugin-sdk. Then it runs the copy's typecheck, tests,\n" +
  "and `bb plugin build`. Plugins run --concurrency at a time (default: up to\n" +
  "4), and every failure is reported at the end.";
const COPY_EXCLUDED = new Set([
  "node_modules",
  "dist",
  ".bundled-runtime",
  ".turbo",
]);

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(USAGE);
  process.exit(0);
}
const keep = args.includes("--keep");
const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
const concurrency =
  concurrencyArg === undefined
    ? Math.min(4, availableParallelism())
    : Number(concurrencyArg.slice("--concurrency=".length));
if (!Number.isInteger(concurrency) || concurrency < 1) {
  console.error(`${concurrencyArg} is not a positive integer\n\n${USAGE}`);
  process.exit(1);
}
const forkable = JSON.parse(
  await readFile(join(repoRoot, "scripts", "forkable-plugins.json"), "utf8"),
).plugins;
const requested = args.filter((arg) => !arg.startsWith("--"));
const pluginDirs = requested.length > 0 ? requested : forkable;
for (const pluginDir of pluginDirs) {
  if (!forkable.includes(pluginDir)) {
    console.error(
      `${pluginDir} is not listed in scripts/forkable-plugins.json\n\n${USAGE}`,
    );
    process.exit(1);
  }
}

async function step(log, label, command, commandArgs, options = {}) {
  const startedAt = Date.now();
  try {
    const result = await run(command, commandArgs, {
      maxBuffer: 64 * 1024 * 1024,
      ...options,
    });
    log.push(
      `  ${label} … ok (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
    );
    return result.stdout;
  } catch (error) {
    log.push(`  ${label} … failed`);
    throw new Error(
      `${label} failed: ${command} ${commandArgs.join(" ")}\n${error.stdout ?? ""}${error.stderr ?? ""}`,
    );
  }
}

function cliEnv(dataDir) {
  const env = { ...process.env, BB_DATA_DIR: dataDir };
  delete env.BB_CLI;
  return env;
}

async function workspaceBinsFor(pluginDir, manifest) {
  const bins = new Map();
  for (const [name, specifier] of Object.entries(
    manifest.devDependencies ?? {},
  )) {
    if (typeof specifier !== "string" || !specifier.startsWith("workspace:")) {
      continue;
    }
    const dependencyManifest = JSON.parse(
      await readFile(
        join(repoRoot, pluginDir, "node_modules", name, "package.json"),
        "utf8",
      ),
    );
    const bin = dependencyManifest.bin;
    bins.set(
      name,
      typeof bin === "string" ? [basename(name)] : Object.keys(bin ?? {}),
    );
  }
  return bins;
}

async function readRegistryItems() {
  const registryDir = join(repoRoot, "packages", "plugin-registry", "r");
  const names = (await readdir(registryDir)).filter(
    (name) => name.endsWith(".json") && name !== "index.json",
  );
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(join(registryDir, name), "utf8")),
    ),
  );
}

async function sourceFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (COPY_EXCLUDED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.(?:tsx?|mts|cts)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

async function vendorRegistryItems(target) {
  const specifiers = new Set();
  for (const file of await sourceFiles(target)) {
    for (const specifier of registryAliasImports(
      await readFile(file, "utf8"),
    )) {
      specifiers.add(specifier);
    }
  }
  const items = registryItemsForImports(specifiers, await readRegistryItems());
  for (const item of items) {
    for (const file of item.files) {
      await mkdir(dirname(join(target, file.target)), { recursive: true });
      await writeFile(join(target, file.target), file.content);
    }
  }
  const [registryManifest, appManifest] = await Promise.all(
    [
      join(repoRoot, "packages", "plugin-registry", "package.json"),
      join(repoRoot, "apps", "app", "package.json"),
    ].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
  );
  return {
    items,
    packages: registryPackages(items, {
      shimmedPackages: new Set(SHIMMED_TYPE_PACKAGES),
      versions: {
        ...registryManifest.devDependencies,
        ...appManifest.devDependencies,
        ...appManifest.dependencies,
      },
    }),
  };
}

async function checkPlugin(pluginDir, workDir, sdkTarball, log) {
  const source = join(repoRoot, pluginDir);
  const target = join(workDir, basename(pluginDir));
  await cp(source, target, {
    recursive: true,
    filter: (path) =>
      !relative(source, path)
        .split(/[\\/]/u)
        .some((segment) => COPY_EXCLUDED.has(segment)),
  });

  const registry = await vendorRegistryItems(target);
  log.push(
    `  registry items: ${registry.items.map((item) => item.name).join(", ")}`,
  );
  const tsconfig = JSON.parse(
    await readFile(join(source, "tsconfig.json"), "utf8"),
  );
  await writeFile(
    join(target, "tsconfig.json"),
    `${JSON.stringify(forkPluginTsconfig(tsconfig), null, 2)}\n`,
  );
  const manifest = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  const forked = forkPluginPackageJson(manifest, {
    sdkSpecifier: `file:${sdkTarball}`,
    workspaceBinsByPackage: await workspaceBinsFor(pluginDir, manifest),
    registryDependencies: registry.packages,
  });
  await writeFile(
    join(target, "package.json"),
    `${JSON.stringify(forked.manifest, null, 2)}\n`,
  );
  log.push(
    `  package.json: @get-bb/plugin-sdk from the packed SDK, registry packages in place of @bb/shared-ui${
      forked.droppedDevDependencies.length > 0
        ? `; dropped workspace tooling ${forked.droppedDevDependencies.join(", ")}`
        : ""
    }${
      forked.droppedScripts.length > 0
        ? ` and scripts ${forked.droppedScripts.join(", ")}`
        : ""
    }`,
  );

  await step(
    log,
    "npm install",
    "npm",
    ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"],
    { cwd: target },
  );
  await step(log, "typecheck", "npm", ["run", "typecheck"], { cwd: target });
  await step(log, "test", "npm", ["test"], { cwd: target });
  await step(
    log,
    "bb plugin build",
    process.execPath,
    [
      join(repoRoot, "apps", "cli", "dist", "index.js"),
      "plugin",
      "build",
      target,
    ],
    { cwd: target, env: cliEnv(join(workDir, "bb-data")) },
  );
  for (const artifact of manifest.bb?.app === undefined
    ? ["server.js"]
    : ["server.js", "app.js", "app.css"]) {
    await stat(join(target, "dist", artifact));
  }
}

const workDir = await mkdtemp(join(tmpdir(), "bb-plugin-fork-"));
if (!relative(repoRoot, workDir).startsWith("..")) {
  console.error(`${workDir} is inside the repository; set TMPDIR elsewhere`);
  process.exit(1);
}
let failed = false;
try {
  console.log(`Work directory: ${workDir}`);
  const printLog = { push: (line) => console.log(line) };
  await step(
    printLog,
    "Build @get-bb/plugin-sdk and the bb CLI",
    "pnpm",
    [
      "exec",
      "turbo",
      "run",
      "build",
      "build:types",
      "--filter=@get-bb/plugin-sdk",
      "--filter=@bb/cli",
      "--output-logs=errors-only",
    ],
    { cwd: repoRoot },
  );
  const packed = JSON.parse(
    await step(
      printLog,
      "Pack @get-bb/plugin-sdk",
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", workDir],
      { cwd: join(repoRoot, "packages", "plugin-sdk") },
    ),
  );
  const sdkTarball = join(workDir, packed[0].filename);
  const queue = [...pluginDirs];
  const failures = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (
        let pluginDir = queue.shift();
        pluginDir !== undefined;
        pluginDir = queue.shift()
      ) {
        const log = [];
        console.log(`Checking ${pluginDir} …`);
        try {
          await checkPlugin(pluginDir, workDir, sdkTarball, log);
        } catch (error) {
          failures.push({ pluginDir, error });
        }
        console.log(`\n${pluginDir}\n${log.join("\n")}`);
      }
    }),
  );
  if (failures.length > 0) {
    failed = true;
    for (const { pluginDir, error } of failures) {
      console.error(
        `\n${pluginDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.error(
      `\n${failures.length} of ${pluginDirs.length} forkable plugin(s) failed: ${failures.map(({ pluginDir }) => pluginDir).join(", ")}`,
    );
  } else {
    console.log(`\n${pluginDirs.length} forkable plugin(s) passed.`);
  }
} catch (error) {
  failed = true;
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
} finally {
  if (keep) {
    console.log(`Kept ${workDir}`);
  } else {
    await rm(workDir, { recursive: true, force: true });
  }
}
process.exit(failed ? 1 : 0);
