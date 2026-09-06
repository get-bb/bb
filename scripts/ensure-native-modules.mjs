import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(fileURLToPath(import.meta.url), "../..");

const WINDOWS_BUILD_TOOLS_URL =
  "https://visualstudio.microsoft.com/visual-cpp-build-tools/";

const nativeModules = [
  {
    name: "better-sqlite3",
    resolveFrom: "packages/db/package.json",
    binaryPath: "build/Release/better_sqlite3.node",
    repair: "prebuild-and-node-gyp",
  },
  {
    name: "node-pty",
    resolveFrom: "apps/host-daemon/package.json",
    repair: "verify-only",
  },
  {
    name: "@parcel/watcher",
    resolveFrom: "apps/host-daemon/package.json",
    repair: "verify-only",
  },
];

export function isWindowsPlatform(platform = process.platform) {
  return platform === "win32";
}

export function formatWindowsBuildGuidance({ detail, name }) {
  const lines = [
    `[ensure-native-modules] ${name} has no usable native binary on Windows.`,
    `Install the "Desktop development with C++" workload from Visual Studio Build Tools`,
    `(${WINDOWS_BUILD_TOOLS_URL}) plus Python 3.11 or newer,`,
    `then reinstall from a prompt with the tools on PATH: pnpm install --frozen-lockfile.`,
    `A plain reinstall also restores skipped optional packages (for example @parcel/watcher-win32-x64).`,
  ];
  if (detail !== undefined && detail !== "") {
    lines.push(`Original error: ${detail}`);
  }
  return lines.join("\n");
}

function formatThrownValue(err) {
  return err instanceof Error ? err.message : String(err);
}

function formatChildProcessFailure(err) {
  const details = [formatThrownValue(err).split("\n")[0]];
  if (err && typeof err === "object") {
    if ("status" in err && err.status !== null && err.status !== undefined) {
      details.push(`exit status: ${String(err.status)}`);
    }
    if ("signal" in err && err.signal !== null && err.signal !== undefined) {
      details.push(`signal: ${String(err.signal)}`);
    }

    for (const streamName of ["stdout", "stderr"]) {
      const output = err[streamName];
      if (output === undefined || output === null) continue;

      const text = Buffer.isBuffer(output)
        ? output.toString("utf8")
        : String(output);
      const trimmed = text.trim();
      if (trimmed.length > 0) {
        details.push(`${streamName}: ${trimmed}`);
      }
    }
  }

  return details.join("\n");
}

export function verifyNativeModule(name, requireModule) {
  const loaded = requireModule(name);
  if (name === "better-sqlite3") {
    const db = new loaded(":memory:");
    db.close();
  }
}

function shouldRebuildNativeModule(errorMessage) {
  return /NODE_MODULE_VERSION|Could not locate the bindings file|Module did not self-register/.test(
    errorMessage,
  );
}

function getRepairedNativeModuleError(name, pkgJsonPath) {
  try {
    // A failed dlopen remains cached for the life of the process. Verify a
    // replacement binary in a fresh process so the old handle cannot poison it.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { createRequire } from "node:module";
const requireModule = createRequire(${JSON.stringify(pkgJsonPath)});
const NativeModule = requireModule(${JSON.stringify(name)});
const instance = new NativeModule(":memory:");
instance.close();`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return null;
  } catch (err) {
    const message = formatChildProcessFailure(err);
    if (!shouldRebuildNativeModule(message)) throw err;
    return message;
  }
}

function detachHardlinkedBinary(binaryPath) {
  let binaryStat;
  try {
    binaryStat = lstatSync(binaryPath);
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }

  if (!binaryStat.isFile() || binaryStat.nlink <= 1) {
    return false;
  }

  // pnpm can hardlink this file across worktrees. An installer writes the new
  // ABI into the existing inode, so every linked checkout changes with it.
  // Replace this checkout's link with a private copy before the repair starts.
  const tempDir = mkdtempSync(join(dirname(binaryPath), ".bb-native-detach-"));
  const detachedPath = join(tempDir, basename(binaryPath));
  let originalWasUnlinked = false;
  try {
    copyFileSync(binaryPath, detachedPath);
    unlinkSync(binaryPath);
    originalWasUnlinked = true;
    renameSync(detachedPath, binaryPath);
    originalWasUnlinked = false;
  } catch (err) {
    if (originalWasUnlinked) {
      renameSync(detachedPath, binaryPath);
    }
    throw err;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return true;
}

export function ensureNativeModules({
  repoRoot = defaultRepoRoot,
  modules = nativeModules,
  createRequire: createRequireImpl = createRequire,
  execFileSync: execFileSyncImpl = execFileSync,
  verifyRepairedNativeModule:
    verifyRepairedNativeModuleImpl = getRepairedNativeModuleError,
  log = console.log,
  platform = process.platform,
} = {}) {
  const windows = isWindowsPlatform(platform);
  for (const {
    name,
    resolveFrom,
    binaryPath,
    repair = "prebuild-and-node-gyp",
  } of modules) {
    const requireModule = createRequireImpl(resolve(repoRoot, resolveFrom));
    const pkgJsonPath = requireModule.resolve(`${name}/package.json`);
    const pkgDir = dirname(pkgJsonPath);
    if (
      binaryPath !== undefined &&
      detachHardlinkedBinary(resolve(pkgDir, binaryPath))
    ) {
      log(
        `[ensure-native-modules] Detached hardlinked ${name} binary before verification`,
      );
    }
    try {
      verifyNativeModule(name, requireModule);
    } catch (err) {
      const message = formatThrownValue(err);
      if (repair === "verify-only" || !shouldRebuildNativeModule(message)) {
        if (windows) {
          throw new Error(
            formatWindowsBuildGuidance({ detail: message, name }),
          );
        }
        throw err;
      }

      const pkgRequire = createRequireImpl(pkgJsonPath);
      log(
        `[ensure-native-modules] Installing prebuilt ${name} for Node ${process.versions.node} (ABI ${process.versions.modules})`,
      );
      let prebuildInstalled = false;
      try {
        execFileSyncImpl(
          process.execPath,
          [pkgRequire.resolve("prebuild-install/bin.js")],
          {
            cwd: pkgDir,
            encoding: "utf8",
            env: { ...process.env, npm_config_loglevel: "info" },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        prebuildInstalled = true;
      } catch (prebuildErr) {
        const message = formatChildProcessFailure(prebuildErr);
        log(
          `[ensure-native-modules] Prebuilt ${name} unavailable or unusable: ${message}`,
        );
      }

      const prebuildVerifyError = verifyRepairedNativeModuleImpl(
        name,
        pkgJsonPath,
      );
      if (prebuildVerifyError === null) {
        if (!prebuildInstalled) {
          log(
            `[ensure-native-modules] Prebuilt ${name} loaded despite installer failure`,
          );
        }
        continue;
      }

      if (prebuildInstalled) {
        log(
          `[ensure-native-modules] Prebuilt ${name} failed to load: ${prebuildVerifyError}`,
        );
      } else {
        log(
          `[ensure-native-modules] Prebuilt ${name} still failed to load: ${prebuildVerifyError}`,
        );
      }

      log(
        `[ensure-native-modules] Rebuilding ${name} from source for Node ${process.versions.node} (ABI ${process.versions.modules})`,
      );
      try {
        execFileSyncImpl(
          process.execPath,
          [
            pkgRequire.resolve("node-gyp/bin/node-gyp.js"),
            "rebuild",
            "--release",
          ],
          {
            cwd: pkgDir,
            stdio: "inherit",
          },
        );
      } catch (rebuildErr) {
        if (windows) {
          throw new Error(
            formatWindowsBuildGuidance({
              detail: formatThrownValue(rebuildErr).split("\n")[0],
              name,
            }),
          );
        }
        throw rebuildErr;
      }

      const rebuildVerifyError = verifyRepairedNativeModuleImpl(
        name,
        pkgJsonPath,
      );
      if (rebuildVerifyError !== null) {
        if (windows) {
          throw new Error(
            formatWindowsBuildGuidance({
              detail: rebuildVerifyError,
              name,
            }),
          );
        }
        throw new Error(
          `[ensure-native-modules] ${name} still failed to load after rebuild: ${rebuildVerifyError}`,
        );
      }
    }
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  ensureNativeModules();
}
