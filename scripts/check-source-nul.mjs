import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";

const binaryExtensions = new Set([".png", ".jpg", ".icns", ".mp4"]);
const { stdout } = await promisify(execFile)("git", ["ls-files", "-z"], {
  maxBuffer: 16 * 1024 * 1024,
});
let checked = 0;
let failed = false;
for (const path of stdout.split("\0")) {
  if (!path || binaryExtensions.has(extname(path).toLowerCase())) continue;
  const bytes = await readFile(path);
  checked++;
  const index = bytes.indexOf(0);
  if (index === -1) continue;
  const line = bytes.subarray(0, index).toString().split("\n").length;
  console.error(
    `${JSON.stringify(path)}:${line}: Literal NUL byte makes this file binary. Use an escape such as \\u0000 in strings; register intentional binary asset extensions in scripts/check-source-nul.mjs.`,
  );
  failed = true;
}
console.log(`Checked ${checked} tracked files for literal NUL bytes.`);
if (failed) process.exitCode = 1;
