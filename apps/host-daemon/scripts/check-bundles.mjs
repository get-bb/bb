import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { bundleTargets } from "./bundle-manifest.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");

async function main() {
  let totalBytes = 0;

  for (const target of bundleTargets) {
    await execFileAsync("node", ["--check", target.outfile]);
    const bundleStats = await stat(target.outfile);
    totalBytes += bundleStats.size;
    console.log(`${target.label}: syntax ok (${bundleStats.size} bytes)`);

    const requiredLiterals = target.requiredLiterals ?? [];
    if (requiredLiterals.length > 0) {
      const bundleSource = await readFile(target.outfile, "utf8");
      const missing = requiredLiterals.filter(
        (literal) => !bundleSource.includes(literal),
      );
      if (missing.length > 0) {
        throw new Error(
          `${target.label}: bundle is missing required literals: ${missing.join(", ")}`,
        );
      }
      console.log(
        `${target.label}: ${requiredLiterals.length} required literals present`,
      );
    }
  }

  const importTargets = [
    {
      label: "daemon entry",
      path: resolve(packageRoot, "dist", "index.js"),
    },
    {
      label: "daemon bundle",
      path: bundleTargets.find((target) => target.label === "daemon")?.outfile,
    },
  ];

  for (const target of importTargets) {
    if (!target.path) {
      throw new Error(`Missing ${target.label} import target`);
    }
    await import(pathToFileURL(target.path).href);
    console.log(`${target.label}: runtime import ok`);
  }

  console.log(`total bundle size: ${totalBytes} bytes`);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
