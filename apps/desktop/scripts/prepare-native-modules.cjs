const { chmod, readFile, readdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

const NODE_PTY_PACKAGE_NAME = "node-pty";
const NODE_MODULES_DIRECTORY = "node_modules";
const NODE_PTY_PREBUILD_PLATFORMS = ["darwin-arm64", "darwin-x64"];
const NODE_PTY_SPAWN_HELPER_RELATIVE_PATHS = [
  path.join("build", "Release", "spawn-helper"),
  ...NODE_PTY_PREBUILD_PLATFORMS.map((platform) =>
    path.join("prebuilds", platform, "spawn-helper"),
  ),
];
const NODE_PTY_ASAR_HELPER_PATH_REWRITE =
  "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');";
const NODE_PTY_IDEMPOTENT_ASAR_HELPER_PATH_REWRITE =
  "helperPath = helperPath.replace(/app\\.asar(?!\\.unpacked)/g, 'app.asar.unpacked');";

async function isDirectory(directoryPath) {
  try {
    const entry = await readdir(directoryPath, { withFileTypes: true });
    return Array.isArray(entry);
  } catch {
    return false;
  }
}

function isNodePtyPackageDirectory(directoryPath) {
  return (
    path.basename(directoryPath) === NODE_PTY_PACKAGE_NAME &&
    path.basename(path.dirname(directoryPath)) === NODE_MODULES_DIRECTORY
  );
}

async function findNodePtyPackageDirectories(rootPath) {
  const matches = [];
  const pending = [rootPath];

  while (pending.length > 0) {
    const directoryPath = pending.pop();
    if (directoryPath === undefined) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const childPath = path.join(directoryPath, entry.name);
      if (isNodePtyPackageDirectory(childPath)) {
        matches.push(childPath);
        continue;
      }
      pending.push(childPath);
    }
  }

  return matches;
}

async function chmodIfPresent(filePath, mode) {
  try {
    await chmod(filePath, mode);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function patchNodePtyHelperPath(packageDirectory) {
  const unixTerminalPath = path.join(
    packageDirectory,
    "lib",
    "unixTerminal.js",
  );
  const source = await readFile(unixTerminalPath, "utf8");

  if (source.includes(NODE_PTY_IDEMPOTENT_ASAR_HELPER_PATH_REWRITE)) {
    return;
  }
  if (!source.includes(NODE_PTY_ASAR_HELPER_PATH_REWRITE)) {
    throw new Error(
      `Unable to patch ${NODE_PTY_PACKAGE_NAME} helper path rewrite in ${unixTerminalPath}`,
    );
  }

  await writeFile(
    unixTerminalPath,
    source.replace(
      NODE_PTY_ASAR_HELPER_PATH_REWRITE,
      NODE_PTY_IDEMPOTENT_ASAR_HELPER_PATH_REWRITE,
    ),
  );
}

async function prepareNodePtyPackageDirectory(packageDirectory) {
  await patchNodePtyHelperPath(packageDirectory);

  await Promise.all(
    NODE_PTY_SPAWN_HELPER_RELATIVE_PATHS.map((relativePath) =>
      chmodIfPresent(path.join(packageDirectory, relativePath), 0o755),
    ),
  );
}

async function preparePackagedNativeModules(appOutDir) {
  if (!(await isDirectory(appOutDir))) {
    throw new Error(`Packaged app output does not exist: ${appOutDir}`);
  }

  const packageDirectories = await findNodePtyPackageDirectories(appOutDir);
  if (packageDirectories.length === 0) {
    throw new Error(
      `Unable to find ${NODE_PTY_PACKAGE_NAME} under ${appOutDir}`,
    );
  }

  await Promise.all(packageDirectories.map(prepareNodePtyPackageDirectory));
  return packageDirectories;
}

async function afterPack(context) {
  await preparePackagedNativeModules(context.appOutDir);
}

async function main() {
  const appOutDir = process.argv[2];
  if (appOutDir === undefined || appOutDir.length === 0) {
    throw new Error(
      "Usage: node apps/desktop/scripts/prepare-native-modules.cjs <appOutDir>",
    );
  }

  await preparePackagedNativeModules(path.resolve(appOutDir));
}

module.exports = afterPack;
module.exports.findNodePtyPackageDirectories = findNodePtyPackageDirectories;
module.exports.prepareNodePtyPackageDirectory = prepareNodePtyPackageDirectory;
module.exports.preparePackagedNativeModules = preparePackagedNativeModules;

if (require.main === module) {
  main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
