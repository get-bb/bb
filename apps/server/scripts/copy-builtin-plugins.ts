import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildPluginApp, buildPluginServer } from "@bb/plugin-build";
import {
  BUILTIN_PLUGINS_DIRECTORY_NAME,
  BUILTIN_PLUGIN_NAMES,
  resolveBuiltinPluginRootPathForModuleDir,
} from "../src/services/plugins/builtin-registry.js";
import { LOGO_CONVENTION_EXTENSIONS } from "../src/services/plugins/app-bundle.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, "..");
const sourceModuleDir = path.resolve(serverRoot, "src", "services", "plugins");
const targetRoot = path.resolve(
  serverRoot,
  "dist",
  BUILTIN_PLUGINS_DIRECTORY_NAME,
);

const RUNTIME_DIRS = ["dist", "skills"] as const;
const RUNTIME_FILES = ["package.json"] as const;
const LOGO_FILES = LOGO_CONVENTION_EXTENSIONS.map(
  (extension) => `logo.${extension}`,
);

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

async function copyBuiltinPlugin(args: {
  build: boolean;
  name: (typeof BUILTIN_PLUGIN_NAMES)[number];
  sourceRoot: string;
  targetRoot: string;
}): Promise<void> {
  if (args.build) {
    await buildPluginServer(args.sourceRoot);
    await buildPluginApp(args.sourceRoot);
  }

  const targetDir = path.join(args.targetRoot, args.name);
  await mkdir(targetDir, { recursive: true });

  for (const fileName of RUNTIME_FILES) {
    await cp(path.join(args.sourceRoot, fileName), path.join(targetDir, fileName));
  }
  for (const dirName of RUNTIME_DIRS) {
    await copyIfExists(path.join(args.sourceRoot, dirName), path.join(targetDir, dirName));
  }
  for (const logoFile of LOGO_FILES) {
    await copyIfExists(path.join(args.sourceRoot, logoFile), path.join(targetDir, logoFile));
  }
}

export async function copyBuiltinPlugins(args: {
  build?: boolean;
  sourceModuleDir?: string;
  targetRoot?: string;
} = {}): Promise<void> {
  const resolvedSourceModuleDir = args.sourceModuleDir ?? sourceModuleDir;
  const resolvedTargetRoot = args.targetRoot ?? targetRoot;
  const build = args.build ?? true;

  await rm(resolvedTargetRoot, { recursive: true, force: true });

  if (BUILTIN_PLUGIN_NAMES.length > 0) {
    await mkdir(resolvedTargetRoot, { recursive: true });
  }

  for (const name of BUILTIN_PLUGIN_NAMES) {
    await copyBuiltinPlugin({
      build,
      name,
      sourceRoot: resolveBuiltinPluginRootPathForModuleDir({
        moduleDir: resolvedSourceModuleDir,
        name,
      }),
      targetRoot: resolvedTargetRoot,
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const targetFlagIndex = process.argv.indexOf("--target");
  const targetArg =
    targetFlagIndex !== -1 ? process.argv[targetFlagIndex + 1] : undefined;
  await copyBuiltinPlugins(
    targetArg !== undefined ? { targetRoot: path.resolve(targetArg) } : {},
  );
}
