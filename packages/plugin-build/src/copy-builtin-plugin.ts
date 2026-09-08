import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPluginOwnedIconPath, pluginPackageJsonSchema } from "@bb/domain";
import { ensurePluginArtifacts } from "./ensure-plugin-artifacts.js";
import type { PluginBuildToolchain } from "./toolchain.js";

const RUNTIME_DIRS = ["dist", "skills"] as const;

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(from: string, to: string): Promise<void> {
  if (await exists(from)) {
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
  if (!(await exists(scriptPath))) return;
  await import(pathToFileURL(scriptPath).href);
}

export async function copyBuiltinPlugin(args: {
  bbVersion: string;
  toolchain: PluginBuildToolchain | null;
  name: string;
  sourceRoot: string;
  targetRoot: string;
}): Promise<void> {
  const copy = async () => {
    if (args.toolchain !== null) await runStageAssets(args.sourceRoot);
    const targetDir = path.join(args.targetRoot, args.name);
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
    const compactIcon = isPluginOwnedIconPath(
      packageJson.bb.branding.icon ?? "",
    )
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
        (targetPath !== targetDir &&
          !targetPath.startsWith(targetDir + path.sep))
      ) {
        throw new Error(
          `manifest branding asset escapes plugin directory: ${asset}`,
        );
      }
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(sourcePath, targetPath);
    }
  };
  if (args.toolchain !== null) {
    await ensurePluginArtifacts({
      rootDir: args.sourceRoot,
      bbVersion: args.bbVersion,
      toolchain: args.toolchain,
      minify: true,
      clean: true,
      consume: copy,
    });
  } else {
    await copy();
  }
}
