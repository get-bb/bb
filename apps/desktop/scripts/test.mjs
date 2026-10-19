import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const linuxCi =
  process.platform === "linux" && process.env.GITHUB_ACTIONS === "true";
if (linuxCi) {
  run("bash", [
    fileURLToPath(
      new URL(
        "../../../.github/actions/setup-workspace/install-electron-libraries.sh",
        import.meta.url,
      ),
    ),
  ]);
}
run(process.execPath, [require.resolve("electron/install.js")]);
const args = [
  process.execPath,
  resolve(dirname(require.resolve("vitest/package.json")), "vitest.mjs"),
  "run",
  "--config",
  "vitest.config.ts",
  ...process.argv.slice(2),
];
if (linuxCi) run("xvfb-run", ["-a", ...args]);
else run(args[0], args.slice(1));
