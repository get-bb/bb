/// <reference path="./proper-lockfile.d.ts" />
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { validatePluginBuildManifest } from "./plugin-manifest.js";
import { PLUGIN_BUILD_FINGERPRINT } from "./generated/build-fingerprint.generated.js";
import { PLUGIN_SDK_VERSION } from "@bb/domain";
import { buildPluginApp } from "./build-plugin-app.js";
import { buildPluginServer } from "./build-plugin-server.js";
import { buildPluginHost } from "./build-plugin-host.js";
import {
  PLUGIN_TOOLCHAIN_PINS,
  type PluginBuildToolchain,
} from "./toolchain.js";

const targets = ["server", "app", "host"] as const;
export type PluginArtifactTarget = (typeof targets)[number];
const recordSchema = z.object({
  key: z.string(),
  minify: z.boolean(),
  inputs: z.array(z.string()),
  outputs: z.record(z.string(), z.string()),
});
const ignored = new Set(["dist", "node_modules", ".git", ".turbo"]);
const filesByTarget = {
  server: ["server.js", "server.js.map", "server.meta.json"],
  app: ["app.js", "app.css", "app.meta.json"],
  host: ["host.js", "host.js.map", "host.meta.json"],
};
const configFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "tsconfig.json",
  "pnpm-workspace.yaml",
];

async function digest(file: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "missing";
    throw error;
  }
}

async function sourceFiles(
  root: string,
  visited = new Set<string>(),
): Promise<string[]> {
  const canonical = await realpath(root);
  if (visited.has(canonical)) return [];
  visited.add(canonical);
  const files: string[] = [];
  for (const entry of await readdir(canonical, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = join(canonical, entry.name);
    const info = entry.isSymbolicLink()
      ? await stat(file).catch(() => null)
      : entry;
    if (info?.isDirectory()) files.push(...(await sourceFiles(file, visited)));
    else if (info?.isFile()) files.push(file);
    else if (entry.isSymbolicLink()) files.push(file);
  }
  return files;
}

const dependenciesSchema = z.object({
  dependencies: z.record(z.string(), z.string()).default({}),
  devDependencies: z.record(z.string(), z.string()).default({}),
  peerDependencies: z.record(z.string(), z.string()).default({}),
  optionalDependencies: z.record(z.string(), z.string()).default({}),
});

async function dependencyIdentity(
  packageRoot: string,
  includeDev: boolean,
): Promise<string> {
  const manifest = dependenciesSchema.parse(
    JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")),
  );
  const names = new Set(
    Object.entries(manifest).flatMap(([kind, dependencies]) =>
      kind === "devDependencies" && !includeDev
        ? []
        : Object.keys(dependencies),
    ),
  );
  const identities: string[] = [];
  for (const name of [...names].sort()) {
    let directory = packageRoot;
    while (true) {
      const candidate = join(directory, "node_modules", name);
      const identity = await realpath(candidate).catch(() => null);
      if (identity !== null) {
        identities.push(
          name,
          identity,
          await digest(join(identity, "package.json")),
        );
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) {
        identities.push(name, "missing");
        break;
      }
      directory = parent;
    }
  }
  return JSON.stringify(identities);
}

async function fingerprint(
  root: string,
  inputs: string[],
  settings: string,
): Promise<string> {
  const files = new Set(await sourceFiles(root));
  const directories = new Set<string>();
  const packageRoots = new Set([root]);
  for (const input of inputs) {
    files.add(input);
    let directory = dirname(input);
    while (directory !== dirname(directory)) {
      if (directories.has(directory)) break;
      directories.add(directory);
      files.add(join(directory, "package.json"));
      if ((await digest(join(directory, "package.json"))) !== "missing") {
        packageRoots.add(directory);
        if (
          !directory.includes(
            `${process.platform === "win32" ? "\\" : "/"}node_modules`,
          ) &&
          directory !== root
        ) {
          for (const file of await sourceFiles(directory)) files.add(file);
        }
        break;
      }
      directory = dirname(directory);
    }
  }
  let directory = root;
  while (true) {
    for (const file of configFiles) files.add(join(directory, file));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const hash = createHash("sha256").update(settings);
  for (const packageRoot of [...packageRoots].sort())
    hash.update(await dependencyIdentity(packageRoot, packageRoot === root));
  const sortedFiles = [...files].sort();
  for (let index = 0; index < sortedFiles.length; index += 64) {
    const records = await Promise.all(
      sortedFiles
        .slice(index, index + 64)
        .map(async (file) => [
          file,
          await realpath(file).catch(() => file),
          await digest(file),
        ]),
    );
    for (const record of records)
      for (const value of record) hash.update(value);
  }
  for (const dir of [...directories].sort()) {
    const names = await readdir(dir).catch(() => []);
    hash.update(dir).update(
      names
        .filter((name) => !ignored.has(name))
        .sort()
        .join("\0"),
    );
  }
  return hash.digest("hex");
}

export async function ensurePluginArtifacts(args: {
  rootDir: string;
  bbVersion: string;
  toolchain: PluginBuildToolchain;
  targets?: readonly PluginArtifactTarget[];
  minify?: boolean;
  clean?: boolean;
  consume?: () => Promise<void>;
}): Promise<{ files: string[]; rebuilt: PluginArtifactTarget[] }> {
  const root = await realpath(args.rootDir);
  const cache = join(root, "node_modules/.cache/bb-plugin-build");
  await mkdir(cache, { recursive: true });
  const release = await lockfile.lock(cache, {
    retries: { retries: 600, minTimeout: 100, maxTimeout: 100 },
    stale: 30_000,
  });
  try {
    const manifestPath = join(root, "package.json");
    const manifest = await validatePluginBuildManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
      root,
      manifestPath,
    );
    if (args.clean)
      await rm(join(root, "dist"), { recursive: true, force: true });
    const toolchainFiles = [
      args.toolchain.esbuild,
      args.toolchain.tailwindNode,
      args.toolchain.tailwindOxide,
    ].map((url) => fileURLToPath(url));
    toolchainFiles.push(...(await sourceFiles(args.toolchain.tailwindCssDir)));
    const toolchainDigest = createHash("sha256");
    for (const file of toolchainFiles.sort())
      toolchainDigest.update(await digest(file));
    const commonSettings = JSON.stringify({
      version: 1,
      bb: args.bbVersion,
      sdk: PLUGIN_SDK_VERSION,
      pins: PLUGIN_TOOLCHAIN_PINS,
      toolchain: toolchainDigest.digest("hex"),
      engine: PLUGIN_BUILD_FINGERPRINT,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    });
    const files: string[] = [];
    const rebuilt: PluginArtifactTarget[] = [];
    for (const target of targets) {
      const outputs = filesByTarget[target].map((file) =>
        join(root, "dist", file),
      );
      const recordPath = join(cache, `${target}.json`);
      if (manifest.bb[target] === undefined) {
        for (const file of outputs) await rm(file, { force: true });
        await rm(recordPath, { force: true });
        continue;
      }
      if (!(args.targets ?? targets).includes(target)) continue;
      const previous = recordSchema.safeParse(
        await readFile(recordPath, "utf8")
          .then((raw) => JSON.parse(raw))
          .catch(() => null),
      );
      const minify =
        args.minify ?? (previous.success ? previous.data.minify : true);
      const settings =
        commonSettings +
        JSON.stringify({ target, minify: target === "app" ? minify : true });
      let current = false;
      if (previous.success) {
        current =
          previous.data.key ===
          (await fingerprint(root, previous.data.inputs, settings));
        for (const file of outputs)
          current =
            current &&
            previous.data.outputs[file] === (await digest(file)) &&
            previous.data.outputs[file] !== "missing";
      }
      if (!current) {
        await rm(recordPath, { force: true });
        const priorInputs = previous.success ? previous.data.inputs : [];
        const before = await fingerprint(root, priorInputs, settings);
        const result =
          target === "server"
            ? await buildPluginServer(root, args.bbVersion, args.toolchain)
            : target === "host"
              ? await buildPluginHost(root, args.bbVersion, args.toolchain)
              : await buildPluginApp(root, args.bbVersion, args.toolchain, {
                  minify,
                });
        const after = await fingerprint(root, priorInputs, settings);
        if (before === after) {
          const record = {
            minify,
            key: await fingerprint(root, result.inputPaths, settings),
            inputs: result.inputPaths,
            outputs: Object.fromEntries(
              await Promise.all(
                outputs.map(async (file) => [file, await digest(file)]),
              ),
            ),
          };
          await writeFile(`${recordPath}.tmp`, JSON.stringify(record));
          await rename(`${recordPath}.tmp`, recordPath);
        }
        rebuilt.push(target);
      }
      files.push(...outputs);
    }
    await args.consume?.();
    return { files, rebuilt };
  } finally {
    await release();
  }
}
