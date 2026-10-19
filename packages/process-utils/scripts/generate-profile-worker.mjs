import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const result = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/profile-worker.ts", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  write: false,
});
const directory = new URL("../src/generated/", import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(
  new URL("profile-worker.ts", directory),
  `export const profileWorkerSource = ${JSON.stringify(result.outputFiles[0].text)};\n`,
);
