import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageEntry = fileURLToPath(
  import.meta.resolve("@ai-ecoverse/gpu-ask.js"),
);
const modelSource = resolve(dirname(packageEntry), "../models/v13");
const modelTarget = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/gpu-ask/v13",
);

await mkdir(modelTarget, { recursive: true });
await cp(modelSource, modelTarget, { recursive: true, force: true });
