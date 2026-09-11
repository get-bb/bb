import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginPackageJsonSchema } from "@bb/domain";
import { runInstallCommand } from "./install-sources.js";

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function installGitDependencies(rootDir: string): Promise<void> {
  const manifestPath = join(rootDir, "package.json");
  const originalManifest = await readFile(manifestPath, "utf8");
  const json: unknown = JSON.parse(originalManifest);
  const runtimeManifest = pluginPackageJsonSchema.parse(json);
  delete runtimeManifest.devDependencies;
  const lockfiles = await Promise.all(
    ["package-lock.json", "npm-shrinkwrap.json"].map(async (name) => {
      const path = join(rootDir, name);
      return { path, content: await readOptionalFile(path) };
    }),
  );
  for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml"]) {
    await rm(join(rootDir, name), { force: true });
  }
  try {
    await writeFile(manifestPath, JSON.stringify(runtimeManifest));
    await runInstallCommand("npm", [
      "install",
      "--prefix",
      rootDir,
      "--ignore-scripts",
      "--omit=dev",
      "--omit=optional",
      "--workspaces=false",
      "--no-audit",
      "--no-fund",
    ]);
  } finally {
    await Promise.all([
      writeFile(manifestPath, originalManifest),
      ...lockfiles.map(({ path, content }) =>
        content === null ? rm(path, { force: true }) : writeFile(path, content),
      ),
    ]);
  }
}
