import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPluginOwnedIconPath, pluginPackageJsonSchema } from "@bb/domain";
import { buildPluginApp } from "./build-plugin-app.js";
import { buildPluginServer } from "./build-plugin-server.js";
import { buildPluginHost } from "./build-plugin-host.js";
import { pathExists } from "./plugin-sdk-install.js";
import type { PluginBuildToolchain } from "./toolchain.js";

const RUNTIME_DIRS = ["dist", "skills"] as const;

async function copyIfExists(from: string, to: string): Promise<void> {
  if (await pathExists(from)) {
    await cp(from, to, { recursive: true });
  }
}

async function writeRuntimePackageJson(args: {
  sourceRoot: string;
  targetDir: string;
}): Promise<void> {
  const raw = await readFile(
    path.join(args.sourceRoot, "package.json"),
    "utf8",
  );
  const packageJson = pluginPackageJsonSchema.parse(JSON.parse(raw));
  await writeFile(
    path.join(args.targetDir, "package.json"),
    `${JSON.stringify(
      {
        ...packageJson,
        bb: {
          ...packageJson.bb,
          server: "./dist/server.js",
          ...(packageJson.bb.app === undefined ? {} : { app: "./dist/app.js" }),
          ...(packageJson.bb.host === undefined
            ? {}
            : { host: "./dist/host.js" }),
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function runStageAssets(sourceRoot: string): Promise<void> {
  const scriptPath = path.join(sourceRoot, "scripts", "stage-assets.mjs");
  if (!(await pathExists(scriptPath))) return;
  await import(pathToFileURL(scriptPath).href);
}

export async function copyPluginRuntime(args: {
  sourceRoot: string;
  targetDir: string;
}): Promise<void> {
  const targetDir = args.targetDir;
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  await writeRuntimePackageJson({
    sourceRoot: args.sourceRoot,
    targetDir,
  });
  for (const dirName of RUNTIME_DIRS) {
    await copyIfExists(
      path.join(args.sourceRoot, dirName),
      path.join(targetDir, dirName),
    );
  }
  const packageJson = pluginPackageJsonSchema.parse(
    JSON.parse(
      await readFile(path.join(args.sourceRoot, "package.json"), "utf8"),
    ),
  );
  const logo = packageJson.bb.branding.logo;
  const compactIcon = isPluginOwnedIconPath(packageJson.bb.branding.icon ?? "")
    ? packageJson.bb.branding.icon
    : undefined;
  const declaredIcons = Object.values(
    packageJson.bb.branding.experimental_icons ?? {},
  );
  for (const asset of [
    compactIcon,
    logo?.light,
    logo?.dark,
    ...declaredIcons,
  ]) {
    if (asset === undefined) continue;
    const sourcePath = path.resolve(args.sourceRoot, asset);
    const targetPath = path.resolve(targetDir, asset);
    if (
      (sourcePath !== args.sourceRoot &&
        !sourcePath.startsWith(args.sourceRoot + path.sep)) ||
      (targetPath !== targetDir && !targetPath.startsWith(targetDir + path.sep))
    ) {
      throw new Error(
        `manifest branding asset escapes plugin directory: ${asset}`,
      );
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }
}

export async function preparePluginRuntime(args: {
  sourceRoot: string;
  targetDir: string;
  bbVersion: string;
  toolchain: PluginBuildToolchain;
}): Promise<void> {
  const buildRoot = await mkdtemp(
    path.join(path.dirname(args.sourceRoot), ".bundled-stage-"),
  );
  try {
    await cp(args.sourceRoot, buildRoot, {
      recursive: true,
      filter: (entry) =>
        !["dist", "node_modules", ".turbo", ".bundled-runtime"].includes(
          path.relative(args.sourceRoot, entry).split(path.sep)[0],
        ),
    });
    const modules = path.join(args.sourceRoot, "node_modules");
    if (await pathExists(modules)) {
      await symlink(
        await realpath(modules),
        path.join(buildRoot, "node_modules"),
        "junction",
      );
    }
    const manifest = pluginPackageJsonSchema.parse(
      JSON.parse(await readFile(path.join(buildRoot, "package.json"), "utf8")),
    );
    await buildPluginServer(buildRoot, args.bbVersion, args.toolchain);
    if (manifest.bb.app !== undefined)
      await buildPluginApp(buildRoot, args.bbVersion, args.toolchain);
    if (manifest.bb.host !== undefined)
      await buildPluginHost(buildRoot, args.bbVersion, args.toolchain);
    await runStageAssets(buildRoot);
    await copyPluginRuntime({
      sourceRoot: buildRoot,
      targetDir: args.targetDir,
    });
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}
