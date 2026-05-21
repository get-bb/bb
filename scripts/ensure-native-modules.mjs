import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");

const nativeModules = [
  { name: "better-sqlite3", resolveFrom: "packages/db/package.json" },
];

for (const { name, resolveFrom } of nativeModules) {
  const require = createRequire(resolve(repoRoot, resolveFrom));
  try {
    require(name);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/NODE_MODULE_VERSION/.test(message)) throw err;

    const pkgDir = dirname(require.resolve(`${name}/package.json`));
    console.log(
      `[ensure-native-modules] Rebuilding ${name} for Node ${process.versions.node} (ABI ${process.versions.modules})`,
    );
    execSync("npx --yes node-gyp rebuild", { cwd: pkgDir, stdio: "inherit" });
  }
}
