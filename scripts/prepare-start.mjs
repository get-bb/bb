import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuildProcess } from "./start-bb.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--worktree")) {
  throw new Error("Usage: pnpm prepare:start [--worktree]");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const result = await runBuildProcess({
  command: process.execPath,
  args: [
    require.resolve("dotenv-cli/cli.js"),
    "-c",
    args[0] === "--worktree" ? "development" : "production",
    "--",
    process.execPath,
    "--conditions=source",
    "--import",
    "tsx",
    resolve(root, "scripts/start-bb.mjs"),
    "prepare",
  ],
  cwd: root,
  env: { ...process.env, NODE_ENV: "production" },
});
if (result.signal !== null)
  throw new Error(`Preparation stopped by ${result.signal}`);
process.exitCode = result.code;
