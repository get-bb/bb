import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const require = createRequire(resolve(root, "package.json"));

await mkdir(dist, { recursive: true });
await build({
  bundle: true,
  entryPoints: [resolve(root, "src/client.ts")],
  format: "esm",
  outfile: resolve(dist, "client.js"),
  packages: "external",
  platform: "node",
  target: "es2022",
});

await new Promise((resolvePromise, reject) => {
  const child = spawn(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--project",
      resolve(root, "tsconfig.client.json"),
    ],
    { stdio: "inherit" },
  );
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolvePromise();
    else reject(new Error(`Type declaration build failed with exit code ${code}`));
  });
});
