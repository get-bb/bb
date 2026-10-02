import { chmodSync, copyFileSync, linkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const PROLOGUE = `const fs = require("node:fs");
const path = require("node:path");
const args =
  process.platform === "win32"
    ? [path.basename(process.argv[1]), ...process.argv.slice(2)]
    : process.argv.slice(2);
const out = (text) => fs.writeSync(1, text);
const err = (text) => fs.writeSync(2, text);
const sleepMs = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
`;

function linkNodeAs(target: string): void {
  try {
    linkSync(process.execPath, target);
  } catch {
    copyFileSync(process.execPath, target);
  }
}

export function installFakeGh(binDir: string, body: string): () => void {
  const originalPath = process.env.PATH;
  const originalNodeOptions = process.env.NODE_OPTIONS;
  const source = `${PROLOGUE}${body}\nprocess.exit(0);\n`;
  if (process.platform === "win32") {
    const script = join(binDir, "fake-gh.cjs");
    writeFileSync(script, source);
    process.env.NODE_OPTIONS = `--require ${JSON.stringify(script)}`;
    linkNodeAs(join(binDir, "gh.exe"));
  } else {
    const script = join(binDir, "gh");
    writeFileSync(script, `#!${process.execPath}\n${source}`);
    chmodSync(script, 0o755);
  }
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  return () => {
    process.env.PATH = originalPath;
    if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = originalNodeOptions;
  };
}
