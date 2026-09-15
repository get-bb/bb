// bb-fork(windows): package scripts run through cmd.exe on Windows, which cannot
// bb-fork(windows): execute a bash launcher, so `pnpm dev:status` and
// bb-fork(windows): `pnpm dev:stop` route to the native dev instance control on
// bb-fork(windows): every platform (upstream removed scripts/bb-dev-app in #3669).
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const [action = "status", ...rest] = process.argv.slice(2);

function run(command, args) {
  const child = spawn(command, args, { cwd: repoRoot, stdio: "inherit" });
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

run(process.execPath, [
  "--conditions=source",
  "--import",
  "tsx",
  resolve(
    repoRoot,
    "packages",
    "scripts",
    "src",
    "commands",
    "dev-instance-control.ts",
  ),
  action,
  ...rest,
]);
