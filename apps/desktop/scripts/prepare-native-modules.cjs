const { spawn } = require("node:child_process");
const { chmod, readFile, readdir, writeFile } = require("node:fs/promises");
const { createRequire } = require("node:module");
const path = require("node:path");

const desktopPackageRoot = path.resolve(__dirname, "..");

const NODE_MODULES_DIRECTORY = "node_modules";
const NODE_PTY_PACKAGE_NAME = "node-pty";
const BETTER_SQLITE3_PACKAGE_NAME = "better-sqlite3";
const PACKAGED_NATIVE_PACKAGE_NAMES = [
  NODE_PTY_PACKAGE_NAME,
  BETTER_SQLITE3_PACKAGE_NAME,
];

// better-sqlite3 must match the runtime that loads it. The packaged app runs
// the bb server through Electron's bundled Node, so the packaged copy has to
// target Electron's ABI. electron-builder's `npmRebuild` would rebuild it for
// us, but in this pnpm workspace better-sqlite3 resolves to the shared
// content-addressed store, so an in-place rebuild clobbers the node-ABI binary
// every other workspace package (and the server test suite) relies on. Instead
// `npmRebuild` is disabled and we fetch the Electron prebuild into the packaged
// copy here, leaving the shared store untouched. Desktop dev runs bb-app with
// the host Node executable so it can use the workspace's normal Node-ABI binary.
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

function packageNameForNodeModulesDirectory(directoryPath) {
  const parentDirectory = path.dirname(directoryPath);
  if (path.basename(parentDirectory) === NODE_MODULES_DIRECTORY) {
    return path.basename(directoryPath);
  }

  const nodeModulesDirectory = path.dirname(parentDirectory);
  if (
    path.basename(nodeModulesDirectory) === NODE_MODULES_DIRECTORY &&
    path.basename(parentDirectory).startsWith("@")
  ) {
    return `${path.basename(parentDirectory)}/${path.basename(directoryPath)}`;
  }

  return undefined;
}

async function findPackageDirectories(rootPath, packageNames) {
  const packageNameSet = new Set(packageNames);
  const matches = new Map(packageNames.map((packageName) => [packageName, []]));
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
      const packageName = packageNameForNodeModulesDirectory(childPath);
      if (packageName !== undefined && packageNameSet.has(packageName)) {
        matches.get(packageName).push(childPath);
        continue;
      }
      pending.push(childPath);
    }
  }

  return matches;
}

async function findNativePackageDirectories(rootPath, packageName) {
  return (await findPackageDirectories(rootPath, [packageName])).get(
    packageName,
  );
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

function resolveBetterSqlite3PrebuildArguments({
  electronVersion,
  arch,
  platform,
}) {
  return [
    "--runtime=electron",
    `--target=${electronVersion}`,
    `--arch=${arch}`,
    `--platform=${platform}`,
  ];
}

async function runPrebuildInstall(packageDirectory, prebuildArguments) {
  const requireFromPackage = createRequire(
    path.join(packageDirectory, "package.json"),
  );
  const prebuildInstallBinPath = requireFromPackage.resolve(
    "prebuild-install/bin.js",
  );

  const exitCode = await new Promise((resolveExitCode) => {
    const child = spawn(
      process.execPath,
      [prebuildInstallBinPath, ...prebuildArguments],
      {
        cwd: packageDirectory,
        stdio: "inherit",
      },
    );
    child.on("error", () => resolveExitCode(1));
    child.on("close", resolveExitCode);
  });

  if (exitCode !== 0) {
    throw new Error(
      `prebuild-install for ${BETTER_SQLITE3_PACKAGE_NAME} exited with code ${
        exitCode ?? "null"
      } (arguments: ${prebuildArguments.join(" ")}). The packaged app needs the ` +
        "Electron-ABI binary; refusing to ship a mismatched build.",
    );
  }
}

async function prepareBetterSqlite3PackageDirectory(packageDirectory, options) {
  await runPrebuildInstall(
    packageDirectory,
    resolveBetterSqlite3PrebuildArguments(options),
  );
}

async function preparePackagedNativeModules(appOutDir, options = {}) {
  if (!(await isDirectory(appOutDir))) {
    throw new Error(`Packaged app output does not exist: ${appOutDir}`);
  }

  const packageDirectories = await findPackageDirectories(
    appOutDir,
    PACKAGED_NATIVE_PACKAGE_NAMES,
  );
  const nodePtyDirectories = packageDirectories.get(NODE_PTY_PACKAGE_NAME);
  if (nodePtyDirectories.length === 0) {
    throw new Error(
      `Unable to find ${NODE_PTY_PACKAGE_NAME} under ${appOutDir}`,
    );
  }
  await Promise.all(nodePtyDirectories.map(prepareNodePtyPackageDirectory));

  // The Electron target is only known on the real afterPack path. Standalone
  // invocations (e.g. tests, manual node-pty repair) omit it and skip the fetch.
  if (options.electronVersion === undefined) {
    return { betterSqlite3Directories: [], nodePtyDirectories };
  }

  const betterSqlite3Directories = packageDirectories.get(
    BETTER_SQLITE3_PACKAGE_NAME,
  );
  if (betterSqlite3Directories.length === 0) {
    throw new Error(
      `Unable to find ${BETTER_SQLITE3_PACKAGE_NAME} under ${appOutDir}`,
    );
  }
  await Promise.all(
    betterSqlite3Directories.map((packageDirectory) =>
      prepareBetterSqlite3PackageDirectory(packageDirectory, {
        arch: options.arch,
        electronVersion: options.electronVersion,
        platform: options.platform,
      }),
    ),
  );

  return { betterSqlite3Directories, nodePtyDirectories };
}

function resolveElectronVersion() {
  const requireFromDesktop = createRequire(
    path.join(desktopPackageRoot, "package.json"),
  );
  return requireFromDesktop("electron/package.json").version;
}

function resolveArchName(context) {
  try {
    const { Arch } = require("electron-builder");
    const archName = Arch[context.arch];
    if (typeof archName === "string") {
      return archName;
    }
  } catch {
    // electron-builder is only resolvable inside the build process; fall back to
    // the host architecture, which matches single-arch builds on a native host.
  }
  return process.arch;
}

async function afterPack(context) {
  await preparePackagedNativeModules(context.appOutDir, {
    arch: resolveArchName(context),
    electronVersion: resolveElectronVersion(),
    platform: context.electronPlatformName ?? process.platform,
  });
}

function parseStandaloneArguments(argv) {
  const options = {};
  let appOutDir;

  for (const argument of argv) {
    const electronVersionMatch = argument.match(/^--electron-version=(.+)$/);
    if (electronVersionMatch) {
      options.electronVersion = electronVersionMatch[1];
      continue;
    }
    const archMatch = argument.match(/^--arch=(.+)$/);
    if (archMatch) {
      options.arch = archMatch[1];
      continue;
    }
    const platformMatch = argument.match(/^--platform=(.+)$/);
    if (platformMatch) {
      options.platform = platformMatch[1];
      continue;
    }
    appOutDir = argument;
  }

  if (options.arch === undefined) {
    options.arch = process.arch;
  }
  if (options.platform === undefined) {
    options.platform = process.platform;
  }

  return { appOutDir, options };
}

async function main() {
  const { appOutDir, options } = parseStandaloneArguments(
    process.argv.slice(2),
  );
  if (appOutDir === undefined || appOutDir.length === 0) {
    throw new Error(
      "Usage: node apps/desktop/scripts/prepare-native-modules.cjs <appOutDir> " +
        "[--electron-version=<version>] [--arch=<arch>] [--platform=<platform>]",
    );
  }

  await preparePackagedNativeModules(path.resolve(appOutDir), options);
}

module.exports = afterPack;
module.exports.findNativePackageDirectories = findNativePackageDirectories;
module.exports.prepareNodePtyPackageDirectory = prepareNodePtyPackageDirectory;
module.exports.prepareBetterSqlite3PackageDirectory =
  prepareBetterSqlite3PackageDirectory;
module.exports.preparePackagedNativeModules = preparePackagedNativeModules;
module.exports.parseStandaloneArguments = parseStandaloneArguments;
module.exports.resolveBetterSqlite3PrebuildArguments =
  resolveBetterSqlite3PrebuildArguments;

if (require.main === module) {
  main().catch((error) => {
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
