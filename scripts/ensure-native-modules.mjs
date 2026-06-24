import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(fileURLToPath(import.meta.url), "../..");

export const nativeModules = [
  { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
];

function formatThrownValue(err) {
  return err instanceof Error ? err.message : String(err);
}

export function verifyNativeModule(name, requireModule) {
  const module = requireModule(name);
  if (name !== "better-sqlite3") {
    return;
  }

  const db = new module(":memory:");
  db.close();
}

function shouldRebuildNativeModule(errorMessage) {
  return /NODE_MODULE_VERSION|Could not locate the bindings file/.test(
    errorMessage,
  );
}

export function ensureNativeModules({
  repoRoot = defaultRepoRoot,
  modules = nativeModules,
  createRequire: createRequireImpl = createRequire,
  execSync: execSyncImpl = execSync,
  log = console.log,
} = {}) {
  for (const { name, resolveFrom } of modules) {
    const requireModule = createRequireImpl(resolve(repoRoot, resolveFrom));
    try {
      verifyNativeModule(name, requireModule);
    } catch (err) {
      const message = formatThrownValue(err);
      if (!shouldRebuildNativeModule(message)) throw err;

      const pkgDir = dirname(requireModule.resolve(`${name}/package.json`));
      log(
        `[ensure-native-modules] Rebuilding ${name} for Node ${process.versions.node} (ABI ${process.versions.modules})`,
      );
      execSyncImpl("npx --yes node-gyp rebuild", {
        cwd: pkgDir,
        stdio: "inherit",
      });

      try {
        verifyNativeModule(name, requireModule);
      } catch (verifyErr) {
        throw new Error(
          `[ensure-native-modules] ${name} still failed to load after rebuild: ${formatThrownValue(verifyErr)}`,
          { cause: verifyErr },
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
