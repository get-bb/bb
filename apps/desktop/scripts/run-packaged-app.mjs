import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";

const packageRoot = process.cwd();
const releaseDir = join(packageRoot, "release");
const appBinaryRelativePath = join("bb.app", "Contents", "MacOS", "bb");

async function resolvePackagedAppBinary() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("mac")) {
      continue;
    }
    return join(releaseDir, entry.name, appBinaryRelativePath);
  }
  throw new Error(`No packaged bb.app found under ${releaseDir}`);
}

const child = spawn(await resolvePackagedAppBinary(), [], {
  env: {
    ...process.env,
    BB_DESKTOP_OPEN_DEVTOOLS: process.env.BB_DESKTOP_OPEN_DEVTOOLS ?? "1",
  },
  stdio: "inherit",
});

process.once("SIGINT", () => {
  child.kill("SIGINT");
});
process.once("SIGTERM", () => {
  child.kill("SIGTERM");
});

const [code, signal] = await once(child, "exit");
if (typeof code === "number") {
  process.exitCode = code;
} else {
  process.exitCode = signal === null ? 1 : 128;
}
