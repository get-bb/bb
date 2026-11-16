import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderApiIndexes } from "./api-index.mjs";

const outputDir = process.argv[2];
if (outputDir === undefined) {
  console.error("Usage: node generate-api-index.mjs <output-directory>");
  process.exit(1);
}

const sdkRoot = path.resolve(import.meta.dirname, "..");
const targetDir = path.resolve(outputDir);
await mkdir(targetDir, { recursive: true });

for (const { filename, content } of renderApiIndexes(sdkRoot)) {
  const target = path.join(targetDir, filename);
  const current = await readFile(target, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current === content) continue;
  const temporary = path.join(targetDir, `.${filename}.${process.pid}.tmp`);
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}
