import {
  createUpdatedPackageContent,
  parsePackageJsonWithVersion,
  writeFilesAtomically,
} from "./lib/package-version.mjs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemver, resolveVersionArgument } from "./lib/semver.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const USAGE =
  "Usage: node scripts/bump-plugin-sdk.mjs <new-version>|--patch|--minor|--major";
export const MANIFEST_PATH = "packages/plugin-sdk/package.json";
export const VERSION_MODULE_PATH = "packages/domain/src/plugin-sdk-version.ts";

const VERSION_EXPORT_PATTERN =
  /(export const PLUGIN_SDK_VERSION = ")([^"]+)(";)/u;

const defaultFileSystem = { readFile, rename, unlink, writeFile };

export function readModuleVersion({ content, path }) {
  const match = VERSION_EXPORT_PATTERN.exec(content);

  if (match === null) {
    throw new Error(`Could not find the PLUGIN_SDK_VERSION export in ${path}`);
  }

  return match[2];
}

export function readPluginSdkVersions({ manifestContent, moduleContent }) {
  return {
    manifestVersion: parsePackageJsonWithVersion({
      content: manifestContent,
      path: MANIFEST_PATH,
    }).version,
    moduleVersion: readModuleVersion({
      content: moduleContent,
      path: VERSION_MODULE_PATH,
    }),
  };
}

function writeModuleVersion({ content, newVersion }) {
  return content.replace(
    VERSION_EXPORT_PATTERN,
    (_match, prefix, _current, suffix) => `${prefix}${newVersion}${suffix}`,
  );
}

export function planPluginSdkBump({
  argument,
  manifestContent,
  moduleContent,
}) {
  const packageJson = parsePackageJsonWithVersion({
    content: manifestContent,
    path: MANIFEST_PATH,
  });
  const currentVersion = packageJson.version;
  const moduleVersion = readModuleVersion({
    content: moduleContent,
    path: VERSION_MODULE_PATH,
  });

  if (currentVersion !== moduleVersion) {
    throw new Error(
      `Version mismatch before bump: ${MANIFEST_PATH}=${currentVersion} ${VERSION_MODULE_PATH}=${moduleVersion}. Set both to the same version, then bump.`,
    );
  }

  const newVersion = resolveVersionArgument({
    argument,
    currentVersion,
    usage: USAGE,
  });

  if (compareSemver(newVersion, currentVersion) <= 0) {
    throw new Error(
      `New version ${newVersion} must be greater than current ${currentVersion}.`,
    );
  }

  return {
    currentVersion,
    newVersion,
    manifestContent: createUpdatedPackageContent({
      content: manifestContent,
      packageJson,
      newVersion,
    }),
    moduleContent: writeModuleVersion({ content: moduleContent, newVersion }),
  };
}

export async function bumpPluginSdk(options) {
  const repoRoot = options.repoRoot;
  const args = options.args;
  const log = options.log;
  const fileSystem = options.fileSystem ?? defaultFileSystem;

  if (args.length !== 1) {
    throw new Error(USAGE);
  }

  const manifestAbsolutePath = resolve(repoRoot, MANIFEST_PATH);
  const moduleAbsolutePath = resolve(repoRoot, VERSION_MODULE_PATH);
  const [manifestContent, moduleContent] = await Promise.all([
    fileSystem.readFile(manifestAbsolutePath, "utf8"),
    fileSystem.readFile(moduleAbsolutePath, "utf8"),
  ]);
  const plan = planPluginSdkBump({
    argument: args[0],
    manifestContent,
    moduleContent,
  });

  await writeFilesAtomically({
    fileSystem,
    temporarySuffix: () => "plugin-sdk-bump",
    updates: [
      {
        absolutePath: manifestAbsolutePath,
        content: manifestContent,
        nextContent: plan.manifestContent,
      },
      {
        absolutePath: moduleAbsolutePath,
        content: moduleContent,
        nextContent: plan.moduleContent,
      },
    ],
  });

  log(
    `Bumped: @get-bb/plugin-sdk ${plan.currentVersion} → ${plan.newVersion} (${MANIFEST_PATH} + ${VERSION_MODULE_PATH})`,
  );
}

async function main() {
  const repoRoot = process.env.BB_BUMP_PLUGIN_SDK_REPO_ROOT ?? defaultRepoRoot;

  await bumpPluginSdk({
    args: process.argv.slice(2),
    log: console.log,
    repoRoot,
  });
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);

    console.error(message);
    process.exitCode = 1;
  });
}
