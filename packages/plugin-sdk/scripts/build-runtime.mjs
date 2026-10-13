import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { promoteRuntimeEntries } from "./promote-runtime-entries.mjs";
import { runtimeBuildOptions, runtimeEntries } from "./runtime-entries.mjs";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const { exports: packageExports } = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);

const entries = runtimeEntries(packageExports);

const stagingDir = await mkdtemp(path.join(packageRoot, ".runtime-build-"));
try {
  for (const entry of entries) {
    const destination = path.join(
      stagingDir,
      path.relative("dist", entry.output),
    );
    if (entry.copy !== undefined) {
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(packageRoot, entry.copy), destination);
      continue;
    }
    await build(runtimeBuildOptions(packageRoot, entry, destination));
  }
  await promoteRuntimeEntries({
    distDir: path.join(packageRoot, "dist"),
    stagingDir,
    relativeOutputs: entries.map((entry) =>
      path.relative("dist", entry.output),
    ),
  });
} finally {
  await rm(stagingDir, { force: true, recursive: true });
}

process.stdout.write(
  `Built ${entries.length} @get-bb/plugin-sdk runtime entries.\n`,
);
