import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(
  process.execPath,
  [
    "--conditions=source",
    "--import",
    "tsx",
    "packages/plugin-build/src/build-bundled-plugin.ts",
    process.cwd(),
  ],
  {
    cwd: resolve(import.meta.dirname, "../../.."),
    stdio: "inherit",
  },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
