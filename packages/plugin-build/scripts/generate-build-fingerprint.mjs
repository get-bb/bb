import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../src");
const output = path.join(root, "generated/build-fingerprint.generated.ts");
const hash = createHash("sha256");
for (const file of [
  path.resolve(root, "../package.json"),
  path.resolve(root, "../../../pnpm-lock.yaml"),
])
  hash.update(await readFile(file));
async function visit(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const file = path.join(directory, entry.name);
    if (file === output || entry.name.endsWith(".test.ts")) continue;
    if (entry.isDirectory()) await visit(file);
    else hash.update(path.relative(root, file)).update(await readFile(file));
  }
}
await visit(root);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  `export const PLUGIN_BUILD_FINGERPRINT = ${JSON.stringify(hash.digest("hex"))};\n`,
);
